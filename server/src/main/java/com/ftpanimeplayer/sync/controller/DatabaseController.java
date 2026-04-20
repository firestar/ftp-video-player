package com.ftpanimeplayer.sync.controller;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Principal;
import java.util.Map;

import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ftpanimeplayer.sync.service.StorageService;

import jakarta.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/api/sync/db")
public class DatabaseController {

    private final StorageService storage;

    public DatabaseController(StorageService storage) {
        this.storage = storage;
    }

    @GetMapping("/meta")
    public ResponseEntity<Map<String, Object>> meta(Principal principal) throws IOException {
        Path db = storage.dbFile(principal.getName());
        if (!Files.exists(db)) {
            return ResponseEntity.ok(Map.of("exists", false));
        }
        return ResponseEntity.ok(Map.of(
                "exists", true,
                "size", Files.size(db),
                "lastModifiedMs", Files.getLastModifiedTime(db).toMillis()));
    }

    @GetMapping(produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<FileSystemResource> download(Principal principal) throws IOException {
        Path db = storage.dbFile(principal.getName());
        if (!Files.exists(db)) {
            return ResponseEntity.notFound().build();
        }
        long lastModified = Files.getLastModifiedTime(db).toMillis();
        long size = Files.size(db);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(size)
                .header(HttpHeaders.LAST_MODIFIED, Long.toString(lastModified))
                .header("X-Sync-LastModified", Long.toString(lastModified))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + StorageService.DB_FILE_NAME + "\"")
                .body(new FileSystemResource(db));
    }

    @PutMapping(consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<Map<String, Object>> upload(Principal principal, HttpServletRequest request)
            throws IOException {
        Path db = storage.dbFile(principal.getName());
        try (InputStream in = request.getInputStream()) {
            long written = storage.writeFile(db, in);
            long lastModified = Files.getLastModifiedTime(db).toMillis();
            return ResponseEntity.ok(Map.of(
                    "size", written,
                    "lastModifiedMs", lastModified));
        }
    }
}
