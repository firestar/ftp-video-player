package com.ftpanimeplayer.sync.controller;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ftpanimeplayer.sync.domain.FtpServerConfig;
import com.ftpanimeplayer.sync.domain.ProbeResult;
import com.ftpanimeplayer.sync.domain.StreamHandle;
import com.ftpanimeplayer.sync.ftp.FtpClient;
import com.ftpanimeplayer.sync.ftp.FtpClientFactory;
import com.ftpanimeplayer.sync.persistence.LibraryStore;
import com.ftpanimeplayer.sync.stream.HlsTranscoder;
import com.ftpanimeplayer.sync.stream.ProbeService;
import com.ftpanimeplayer.sync.stream.StreamRegistry;

import jakarta.servlet.http.HttpServletResponse;

/**
 * Streaming surface for mobile/TV clients. Replaces the local-only
 * {@code src/main/stream-server.ts}:
 * <ul>
 *   <li>{@code /register} → token the client uses for every other streaming URL</li>
 *   <li>{@code /probe}    → JSON codec/duration/subtitle info</li>
 *   <li>{@code /direct}   → raw byte-range passthrough (if container allows it)</li>
 *   <li>{@code /hls/*}    → HLS master.m3u8 + media.m3u8 + segments (ffmpeg)</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/stream")
public class StreamController {

    private final StreamRegistry registry;
    private final ProbeService probeService;
    private final HlsTranscoder hls;
    private final FtpClientFactory ftpFactory;
    private final LibraryStore store;

    public StreamController(StreamRegistry registry,
                            ProbeService probeService,
                            HlsTranscoder hls,
                            FtpClientFactory ftpFactory,
                            LibraryStore store) {
        this.registry = registry;
        this.probeService = probeService;
        this.hls = hls;
        this.ftpFactory = ftpFactory;
        this.store = store;
    }

    public static final class RegisterRequest {
        public String serverId;
        public String path;
        public long size;
    }

    @PostMapping("/register")
    public StreamHandle register(@RequestBody RegisterRequest req) {
        StreamRegistry.Registration reg = registry.register(req.serverId, req.path, req.size);
        String base = "/api/stream/" + reg.token;
        StreamHandle handle = new StreamHandle();
        handle.setToken(reg.token);
        handle.setDirectUrl(base + "/direct");
        handle.setHlsUrl(base + "/hls/master.m3u8");
        handle.setTranscodeUrl(base + "/hls/master.m3u8"); // legacy alias used by desktop renderer
        handle.setProbeUrl(base + "/probe");
        handle.setSubtitleUrl(base + "/subtitle");
        handle.setSubtitlesUrl(base + "/subtitles");
        handle.setUrl(base + "/direct");
        return handle;
    }

    @DeleteMapping("/{token}")
    public ResponseEntity<Void> unregister(@PathVariable String token) {
        hls.stop(token);
        probeService.evict(token);
        registry.unregister(token);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{token}/probe")
    public ProbeResult probe(@PathVariable String token) throws IOException {
        StreamRegistry.Registration reg = registry.get(token)
                .orElseThrow(() -> new IllegalArgumentException("unknown token " + token));
        return probeService.probe(reg);
    }

    /**
     * Byte-range passthrough from FTP. Supports {@code Range} header so native
     * players can seek. Mirrors the direct-play handler in
     * {@code src/main/stream-server.ts:128}.
     */
    @GetMapping("/{token}/direct")
    public void direct(@PathVariable String token,
                       @RequestHeader(value = "Range", required = false) String range,
                       HttpServletResponse response) throws IOException {
        StreamRegistry.Registration reg = registry.get(token)
                .orElseThrow(() -> new IllegalArgumentException("unknown token " + token));
        FtpServerConfig cfg = store.getServer(reg.serverId)
                .orElseThrow(() -> new IllegalArgumentException("unknown server " + reg.serverId));

        long start = 0;
        long end = reg.size - 1;
        if (range != null && range.startsWith("bytes=")) {
            String[] parts = range.substring("bytes=".length()).split("-", 2);
            try {
                if (!parts[0].isBlank()) start = Long.parseLong(parts[0]);
                if (parts.length > 1 && !parts[1].isBlank()) end = Long.parseLong(parts[1]);
            } catch (NumberFormatException ignored) {
                // fall back to whole file
            }
        }
        long length = end - start + 1;
        response.setStatus(range != null ? HttpStatus.PARTIAL_CONTENT.value() : HttpStatus.OK.value());
        response.setHeader(HttpHeaders.ACCEPT_RANGES, "bytes");
        response.setHeader(HttpHeaders.CONTENT_TYPE, contentType(reg.path));
        response.setHeader(HttpHeaders.CONTENT_LENGTH, Long.toString(length));
        if (range != null) {
            response.setHeader(HttpHeaders.CONTENT_RANGE, "bytes " + start + "-" + end + "/" + reg.size);
        }

        try (FtpClient client = ftpFactory.open(cfg);
             InputStream in = client.openReadStream(reg.path, start, end);
             OutputStream out = response.getOutputStream()) {
            in.transferTo(out);
        }
    }

    @GetMapping(value = "/{token}/hls/master.m3u8", produces = "application/vnd.apple.mpegurl")
    public ResponseEntity<String> master(@PathVariable String token) throws IOException {
        StreamRegistry.Registration reg = registry.get(token)
                .orElseThrow(() -> new IllegalArgumentException("unknown token " + token));
        Path master = hls.startOrGet(reg);
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-cache")
                .body(Files.readString(master));
    }

    @GetMapping(value = "/{token}/hls/media.m3u8", produces = "application/vnd.apple.mpegurl")
    public ResponseEntity<String> media(@PathVariable String token) throws IOException {
        Path media = hls.mediaPlaylist(token)
                .orElseThrow(() -> new IllegalArgumentException("hls session not started for " + token));
        // Poll for the playlist to appear; ffmpeg writes it once the first
        // segment is ready. Bounded wait so clients see a fresh playlist
        // without blocking forever.
        long deadline = System.currentTimeMillis() + Duration.ofSeconds(30).toMillis();
        while (!Files.exists(media) && System.currentTimeMillis() < deadline) {
            try { Thread.sleep(200); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
        }
        if (!Files.exists(media)) return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-cache")
                .body(Files.readString(media));
    }

    @GetMapping("/{token}/hls/{segment}")
    public ResponseEntity<Resource> segment(@PathVariable String token, @PathVariable String segment) throws IOException {
        Path seg = hls.segmentFile(token, segment)
                .orElseThrow(() -> new IllegalArgumentException("unknown segment " + segment));
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("video/mp2t"))
                .header(HttpHeaders.CACHE_CONTROL, "public,max-age=86400,immutable")
                .body(new InputStreamResource(Files.newInputStream(seg)));
    }

    private static String contentType(String path) {
        String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
        return switch (ext) {
            case "mkv" -> "video/x-matroska";
            case "mp4", "m4v" -> "video/mp4";
            case "webm" -> "video/webm";
            case "mov" -> "video/quicktime";
            case "avi" -> "video/x-msvideo";
            case "ts" -> "video/mp2t";
            case "wmv" -> "video/x-ms-wmv";
            case "flv" -> "video/x-flv";
            default -> "application/octet-stream";
        };
    }
}
