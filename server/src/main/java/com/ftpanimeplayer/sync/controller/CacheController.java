package com.ftpanimeplayer.sync.controller;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Principal;
import java.util.List;
import java.util.Map;

import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ftpanimeplayer.sync.service.StorageService;
import com.ftpanimeplayer.sync.service.StorageService.CacheKind;

import jakarta.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/api/sync/cache")
public class CacheController {

    private final StorageService storage;

    public CacheController(StorageService storage) {
        this.storage = storage;
    }

    @GetMapping("/{kind}")
    public ResponseEntity<Map<String, Object>> list(Principal principal, @PathVariable String kind) {
        CacheKind parsed = CacheKind.parse(kind);
        List<StorageService.StoredFile> files = storage.listCache(principal.getName(), parsed);
        return ResponseEntity.ok(Map.of(
                "kind", parsed.folder(),
                "count", files.size(),
                "files", files));
    }

    @GetMapping(value = "/{kind}/{name}", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<FileSystemResource> download(
            Principal principal,
            @PathVariable String kind,
            @PathVariable String name) throws IOException {
        CacheKind parsed = CacheKind.parse(kind);
        Path file = storage.cacheFile(principal.getName(), parsed, name);
        if (!Files.exists(file)) {
            return ResponseEntity.notFound().build();
        }
        long size = Files.size(file);
        long lastModified = Files.getLastModifiedTime(file).toMillis();
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(size)
                .header(HttpHeaders.LAST_MODIFIED, Long.toString(lastModified))
                .header("X-Sync-LastModified", Long.toString(lastModified))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
                .body(new FileSystemResource(file));
    }

    @PutMapping(value = "/{kind}/{name}", consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<Map<String, Object>> upload(
            Principal principal,
            @PathVariable String kind,
            @PathVariable String name,
            HttpServletRequest request) throws IOException {
        CacheKind parsed = CacheKind.parse(kind);
        Path file = storage.cacheFile(principal.getName(), parsed, name);
        try (InputStream in = request.getInputStream()) {
            long written = storage.writeFile(file, in);
            long lastModified = Files.getLastModifiedTime(file).toMillis();
            return ResponseEntity.ok(Map.of(
                    "name", name,
                    "size", written,
                    "lastModifiedMs", lastModified));
        }
    }

    @DeleteMapping("/{kind}/{name}")
    public ResponseEntity<Map<String, Object>> delete(
            Principal principal,
            @PathVariable String kind,
            @PathVariable String name) throws IOException {
        CacheKind parsed = CacheKind.parse(kind);
        Path file = storage.cacheFile(principal.getName(), parsed, name);
        boolean deleted = storage.delete(file);
        return ResponseEntity.ok(Map.of("deleted", deleted, "name", name));
    }
}
