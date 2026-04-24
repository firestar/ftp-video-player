package com.ftpanimeplayer.sync.stream;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ftpanimeplayer.sync.config.PlayerProperties;
import com.ftpanimeplayer.sync.domain.FtpServerConfig;
import com.ftpanimeplayer.sync.domain.ProbeResult;
import com.ftpanimeplayer.sync.domain.SubtitleTrackInfo;
import com.ftpanimeplayer.sync.ftp.FtpClient;
import com.ftpanimeplayer.sync.ftp.FtpClientFactory;
import com.ftpanimeplayer.sync.persistence.LibraryStore;

/**
 * Wraps {@code ffprobe}. The original implementation in
 * {@code src/main/stream-server.ts} pointed ffprobe at an internal HTTP
 * endpoint so it could range-seek; here we just stream the head of the FTP
 * file into ffprobe via stdin. That's enough for every codec detection case
 * except AVI's {@code idx1}-at-end layout; AVI always goes through the
 * transcode path anyway, so the approximation is safe.
 */
@Component
public class ProbeService {

    private static final Set<String> TEXT_SUBTITLE_CODECS = Set.of(
            "subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "tx3g", "text", "microdvd");

    private final PlayerProperties playerProperties;
    private final FtpClientFactory ftpFactory;
    private final LibraryStore store;
    private final ObjectMapper json = new ObjectMapper();

    /** Probe results are cached by token so /hls-master can check direct-play without re-probing. */
    private final Map<String, ProbeResult> cache = new ConcurrentHashMap<>();

    public ProbeService(PlayerProperties playerProperties, FtpClientFactory ftpFactory, LibraryStore store) {
        this.playerProperties = playerProperties;
        this.ftpFactory = ftpFactory;
        this.store = store;
    }

    public ProbeResult probe(StreamRegistry.Registration reg) throws IOException {
        ProbeResult cached = cache.get(reg.token);
        if (cached != null) return cached;

        Optional<FtpServerConfig> server = store.getServer(reg.serverId);
        if (server.isEmpty()) throw new IOException("server missing");

        ProcessBuilder pb = new ProcessBuilder(
                playerProperties.getFfprobePath(),
                "-v", "error",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                "-probesize", "10000000",
                "-analyzeduration", "10000000",
                "-i", "pipe:0");
        pb.redirectErrorStream(false);
        Process proc = pb.start();

        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        Thread reader = new Thread(() -> {
            try (InputStream is = proc.getInputStream()) {
                is.transferTo(stdout);
            } catch (IOException ignored) {
                // ffprobe exited
            }
        }, "ffprobe-stdout");
        reader.setDaemon(true);
        reader.start();

        try (FtpClient client = ftpFactory.open(server.get());
             InputStream in = client.openReadStream(reg.path, 0, Math.min(reg.size - 1, 32L * 1024 * 1024))) {
            try {
                in.transferTo(proc.getOutputStream());
            } catch (IOException ignored) {
                // ffprobe may have enough data and close stdin early
            } finally {
                try { proc.getOutputStream().close(); } catch (IOException ignored) { }
            }
        } catch (Exception e) {
            proc.destroyForcibly();
            throw new IOException("ffprobe source read failed", e);
        }

        try {
            if (!proc.waitFor(60, TimeUnit.SECONDS)) {
                proc.destroyForcibly();
                throw new IOException("ffprobe timed out");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            proc.destroyForcibly();
            throw new IOException("interrupted", e);
        }
        try { reader.join(1_000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }

        ProbeResult result = parse(stdout.toByteArray(), reg);
        cache.put(reg.token, result);
        return result;
    }

    private ProbeResult parse(byte[] bytes, StreamRegistry.Registration reg) throws IOException {
        JsonNode root = json.readTree(bytes);
        JsonNode format = root.get("format");
        JsonNode streams = root.get("streams");
        ProbeResult out = new ProbeResult();
        if (format != null && format.hasNonNull("format_name")) out.setContainer(format.get("format_name").asText());
        if (format != null && format.hasNonNull("duration")) {
            try { out.setDuration(Double.parseDouble(format.get("duration").asText())); } catch (NumberFormatException ignored) {}
        }
        String videoCodec = null;
        String audioCodec = null;
        Map<Integer, String> codecMap = new HashMap<>();
        if (streams != null && streams.isArray()) {
            for (JsonNode s : streams) {
                String type = s.path("codec_type").asText("");
                String codec = s.path("codec_name").asText(null);
                if ("video".equals(type) && videoCodec == null) videoCodec = codec;
                else if ("audio".equals(type) && audioCodec == null) audioCodec = codec;
                else if ("subtitle".equals(type)) {
                    SubtitleTrackInfo info = new SubtitleTrackInfo();
                    info.setIndex(s.path("index").asInt());
                    info.setCodec(codec != null ? codec : "unknown");
                    if (s.path("tags").hasNonNull("language")) info.setLanguage(s.path("tags").get("language").asText());
                    if (s.path("tags").hasNonNull("title")) info.setTitle(s.path("tags").get("title").asText());
                    info.setIsDefault(s.path("disposition").path("default").asInt(0) == 1);
                    info.setTextBased(codec != null && TEXT_SUBTITLE_CODECS.contains(codec.toLowerCase()));
                    out.getSubtitles().add(info);
                    if (codec != null) codecMap.put(info.getIndex(), codec);
                }
            }
        }
        out.setVideoCodec(videoCodec);
        out.setAudioCodec(audioCodec);
        out.setDirectPlayable(DirectPlayPolicy.canDirectPlay(videoCodec, audioCodec, reg.path));
        reg.subtitleCodecs = codecMap;
        return out;
    }

    public void evict(String token) {
        cache.remove(token);
    }

    public static boolean isTextSubtitle(String codec) {
        return codec != null && TEXT_SUBTITLE_CODECS.contains(codec.toLowerCase());
    }
}
