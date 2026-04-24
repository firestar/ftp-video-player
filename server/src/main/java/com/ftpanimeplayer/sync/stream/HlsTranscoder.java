package com.ftpanimeplayer.sync.stream;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Comparator;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Stream;

import org.springframework.stereotype.Component;

import com.ftpanimeplayer.sync.config.PlayerProperties;
import com.ftpanimeplayer.sync.domain.FtpServerConfig;
import com.ftpanimeplayer.sync.ftp.FtpClient;
import com.ftpanimeplayer.sync.ftp.FtpClientFactory;
import com.ftpanimeplayer.sync.persistence.LibraryStore;

import jakarta.annotation.PostConstruct;

/**
 * Spawns one {@code ffmpeg} process per stream token and writes an HLS VOD
 * playlist + segments to disk. AVPlayer (iOS/tvOS) and Media3's HlsMediaSource
 * (Android/Android TV) can both consume the resulting {@code master.m3u8}
 * directly.
 *
 * <p>Compare with the fMP4-over-HTTP transcode in
 * {@code src/main/stream-server.ts} — HLS is preferred here because mobile
 * players handle HLS seeking natively without needing custom byte-range
 * handling.
 */
@Component
public class HlsTranscoder {

    private final PlayerProperties playerProperties;
    private final FtpClientFactory ftpFactory;
    private final LibraryStore store;

    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private Semaphore concurrencyGate;
    private Path rootDir;

    public HlsTranscoder(PlayerProperties playerProperties, FtpClientFactory ftpFactory, LibraryStore store) {
        this.playerProperties = playerProperties;
        this.ftpFactory = ftpFactory;
        this.store = store;
    }

    @PostConstruct
    void init() throws IOException {
        this.concurrencyGate = new Semaphore(Math.max(1, playerProperties.getMaxConcurrentTranscodes()), true);
        this.rootDir = Paths.get(playerProperties.getTranscodeDir());
        Files.createDirectories(rootDir);
        // On startup, wipe any left-over transcodes from a crashed previous run.
        try (Stream<Path> walk = Files.walk(rootDir)) {
            walk.sorted(Comparator.reverseOrder())
                    .filter(p -> !p.equals(rootDir))
                    .forEach(p -> { try { Files.delete(p); } catch (IOException ignored) {} });
        }
    }

    /**
     * Kicks off a session (idempotent per token). Returns the master playlist
     * path so the controller can serve it.
     */
    public Path startOrGet(StreamRegistry.Registration reg) throws IOException {
        Session existing = sessions.get(reg.token);
        if (existing != null) {
            return existing.masterPlaylist();
        }
        try {
            if (!concurrencyGate.tryAcquire()) {
                throw new IOException("transcode concurrency exhausted; retry later");
            }
        } catch (Exception e) {
            throw new IOException("transcode gate error", e);
        }
        Session session = new Session(reg);
        try {
            session.start();
            sessions.put(reg.token, session);
            return session.masterPlaylist();
        } catch (IOException e) {
            concurrencyGate.release();
            session.stop();
            throw e;
        }
    }

    public Optional<Path> segmentFile(String token, String filename) {
        Session s = sessions.get(token);
        if (s == null) return Optional.empty();
        Path p = s.sessionDir().resolve(filename).normalize();
        if (!p.startsWith(s.sessionDir())) return Optional.empty();
        if (!Files.exists(p)) return Optional.empty();
        return Optional.of(p);
    }

    public void stop(String token) {
        Session s = sessions.remove(token);
        if (s != null) {
            s.stop();
            concurrencyGate.release();
        }
    }

    public Optional<Path> mediaPlaylist(String token) {
        Session s = sessions.get(token);
        return s == null ? Optional.empty() : Optional.of(s.mediaPlaylist());
    }

    final class Session {
        private final StreamRegistry.Registration reg;
        private final Path dir;
        private final AtomicBoolean stopped = new AtomicBoolean(false);
        private Process proc;
        private Thread pumpThread;

        Session(StreamRegistry.Registration reg) {
            this.reg = reg;
            this.dir = rootDir.resolve(reg.token);
        }

        Path sessionDir() { return dir; }
        Path masterPlaylist() { return dir.resolve("master.m3u8"); }
        Path mediaPlaylist() { return dir.resolve("media.m3u8"); }

        void start() throws IOException {
            Files.createDirectories(dir);
            writeMasterPlaylist();

            ProcessBuilder pb = new ProcessBuilder(
                    playerProperties.getFfmpegPath(),
                    "-hide_banner",
                    "-loglevel", "warning",
                    "-i", "pipe:0",
                    "-map", "0:v:0",
                    "-map", "0:a:0?",
                    "-c:v", "libx264",
                    "-preset", "veryfast",
                    "-crf", "20",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-ac", "2",
                    "-f", "hls",
                    "-hls_time", "6",
                    "-hls_playlist_type", "vod",
                    "-hls_flags", "independent_segments",
                    "-hls_segment_filename", dir.resolve("seg_%05d.ts").toString(),
                    mediaPlaylist().toString()
            );
            pb.redirectErrorStream(true);
            pb.redirectOutput(dir.resolve("ffmpeg.log").toFile());
            proc = pb.start();

            Optional<FtpServerConfig> server = store.getServer(reg.serverId);
            if (server.isEmpty()) {
                stop();
                throw new IOException("server missing: " + reg.serverId);
            }

            // Pump the FTP read into ffmpeg's stdin on a worker thread so
            // start() returns immediately and the first segment can appear
            // before the whole file is transferred.
            pumpThread = new Thread(() -> {
                try (FtpClient client = ftpFactory.open(server.get());
                     InputStream in = client.openReadStream(reg.path, 0, reg.size - 1);
                     OutputStream out = proc.getOutputStream()) {
                    in.transferTo(out);
                } catch (IOException ignored) {
                    // ffmpeg closed stdin or FTP dropped; we'll see it in the playlist
                } finally {
                    try { proc.getOutputStream().close(); } catch (IOException ignored) {}
                }
            }, "hls-pump-" + reg.token);
            pumpThread.setDaemon(true);
            pumpThread.start();
        }

        private void writeMasterPlaylist() throws IOException {
            String content = """
                #EXTM3U
                #EXT-X-VERSION:4
                #EXT-X-STREAM-INF:BANDWIDTH=3500000,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1920x1080
                media.m3u8
                """;
            Files.writeString(masterPlaylist(), content);
        }

        void stop() {
            if (!stopped.compareAndSet(false, true)) return;
            if (proc != null) proc.destroyForcibly();
            if (pumpThread != null) pumpThread.interrupt();
            // Keep the session dir around for a short while so late segment
            // requests don't 404; cleanup happens on next startup.
        }
    }
}
