package com.ftpanimeplayer.sync.service;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

import org.springframework.stereotype.Service;

import com.ftpanimeplayer.sync.config.SyncProperties;

@Service
public class StorageService {

    public static final String DB_FILE_NAME = "ftp-anime-player.db";

    private final Path root;

    public StorageService(SyncProperties properties) {
        this.root = Paths.get(properties.getDataDir()).toAbsolutePath().normalize();
        try {
            Files.createDirectories(root);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to create sync data directory at " + root, e);
        }
    }

    public Path dbFile(String username) {
        Path dir = userRoot(username).resolve("db");
        ensureDir(dir);
        return dir.resolve(DB_FILE_NAME);
    }

    public Path cacheFile(String username, CacheKind kind, String name) {
        validateName(name);
        Path dir = userRoot(username).resolve("cache").resolve(kind.folder());
        ensureDir(dir);
        Path resolved = dir.resolve(name).normalize();
        // Defense-in-depth — validateName should have already blocked traversal,
        // but double-check the resolved path still sits under the cache dir.
        if (!resolved.startsWith(dir)) {
            throw new IllegalArgumentException("Invalid cache file name: " + name);
        }
        return resolved;
    }

    public List<StoredFile> listCache(String username, CacheKind kind) {
        Path dir = userRoot(username).resolve("cache").resolve(kind.folder());
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        List<StoredFile> out = new ArrayList<>();
        try (Stream<Path> stream = Files.list(dir)) {
            stream.filter(Files::isRegularFile).forEach(p -> {
                try {
                    out.add(new StoredFile(
                            p.getFileName().toString(),
                            Files.size(p),
                            Files.getLastModifiedTime(p).toMillis()));
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        out.sort(Comparator.comparing(StoredFile::name));
        return out;
    }

    public long writeFile(Path target, InputStream body) throws IOException {
        ensureDir(target.getParent());
        Path tmp = target.resolveSibling(target.getFileName() + ".part");
        try {
            long bytes = Files.copy(body, tmp, StandardCopyOption.REPLACE_EXISTING);
            // Atomic rename so concurrent readers never see a partial payload.
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            return bytes;
        } catch (IOException ex) {
            Files.deleteIfExists(tmp);
            throw ex;
        }
    }

    public boolean delete(Path target) throws IOException {
        return Files.deleteIfExists(target);
    }

    private Path userRoot(String username) {
        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException("username required");
        }
        // Only allow a restricted set of characters to avoid any attempt at
        // injecting path segments via the authenticated principal name.
        if (!username.matches("[A-Za-z0-9_.@-]+")) {
            throw new IllegalArgumentException("invalid username");
        }
        Path dir = root.resolve("users").resolve(username).normalize();
        if (!dir.startsWith(root)) {
            throw new IllegalArgumentException("invalid username path");
        }
        ensureDir(dir);
        return dir;
    }

    private void validateName(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("file name required");
        }
        if (name.contains("/") || name.contains("\\") || name.contains("..") || name.startsWith(".")) {
            throw new IllegalArgumentException("invalid file name: " + name);
        }
    }

    private void ensureDir(Path dir) {
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to create directory " + dir, e);
        }
    }

    public record StoredFile(String name, long size, long lastModifiedMs) {
    }

    public enum CacheKind {
        POSTERS("posters"),
        THUMBNAILS("thumbnails");

        private final String folder;

        CacheKind(String folder) {
            this.folder = folder;
        }

        public String folder() {
            return folder;
        }

        public static CacheKind parse(String raw) {
            if (raw == null) {
                throw new IllegalArgumentException("cache kind required");
            }
            return switch (raw.toLowerCase()) {
                case "posters" -> POSTERS;
                case "thumbnails" -> THUMBNAILS;
                default -> throw new IllegalArgumentException("unknown cache kind: " + raw);
            };
        }
    }
}
