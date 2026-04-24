package com.ftpanimeplayer.sync.library;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;

import org.springframework.stereotype.Component;

import com.ftpanimeplayer.sync.domain.AnimeEntry;
import com.ftpanimeplayer.sync.domain.AnimeMetadata;
import com.ftpanimeplayer.sync.domain.FtpServerConfig;
import com.ftpanimeplayer.sync.domain.LibraryRoot;
import com.ftpanimeplayer.sync.domain.RemoteEntry;
import com.ftpanimeplayer.sync.domain.VideoFile;
import com.ftpanimeplayer.sync.ftp.FtpClient;
import com.ftpanimeplayer.sync.ftp.FtpClientFactory;
import com.ftpanimeplayer.sync.persistence.LibraryStore;

/**
 * Server-side equivalent of {@code src/main/library.ts}. Two-phase scan:
 * list folders and emit them (phase 1), then resolve metadata on a
 * background task (phase 2).
 */
@Component
public class LibraryScanner {

    private static final List<String> VIDEO_EXTENSIONS = List.of(
            ".mkv", ".mp4", ".avi", ".mov", ".webm", ".m4v", ".ts", ".wmv", ".flv");

    private final LibraryStore store;
    private final FtpClientFactory factory;
    private final JikanClient jikan;

    public LibraryScanner(LibraryStore store, FtpClientFactory factory, JikanClient jikan) {
        this.store = store;
        this.factory = factory;
        this.jikan = jikan;
    }

    public static String animeId(String serverId, String folderPath) {
        return sha1(serverId + ":" + folderPath);
    }

    public static boolean isVideoFile(String name) {
        String lower = name.toLowerCase();
        for (String ext : VIDEO_EXTENSIONS) {
            if (lower.endsWith(ext)) return true;
        }
        return false;
    }

    public List<VideoFile> listFolderVideos(String serverId, String folderPath) throws Exception {
        Optional<FtpServerConfig> server = store.getServer(serverId);
        if (server.isEmpty()) return List.of();
        try (FtpClient client = factory.open(server.get())) {
            List<RemoteEntry> entries = client.list(folderPath);
            List<VideoFile> videos = new ArrayList<>();
            for (RemoteEntry e : entries) {
                if (e.getType() != RemoteEntry.Type.file) continue;
                if (!isVideoFile(e.getName())) continue;
                VideoFile vf = new VideoFile();
                vf.setName(e.getName());
                vf.setPath(e.getPath());
                vf.setSize(e.getSize());
                vf.setModifiedAt(e.getModifiedAt());
                videos.add(vf);
            }
            return videos;
        }
    }

    public List<AnimeEntry> scanRoot(LibraryRoot root) throws Exception {
        Optional<FtpServerConfig> server = store.getServer(root.getServerId());
        if (server.isEmpty()) return List.of();
        try (FtpClient client = factory.open(server.get())) {
            List<RemoteEntry> children = client.list(root.getPath());
            List<AnimeEntry> out = new ArrayList<>();
            for (RemoteEntry child : children) {
                if (child.getType() != RemoteEntry.Type.directory) continue;
                AnimeEntry entry = new AnimeEntry();
                entry.setId(animeId(server.get().getId(), child.getPath()));
                entry.setServerId(server.get().getId());
                entry.setLibraryRootId(root.getId());
                entry.setFolderName(child.getName());
                entry.setPath(child.getPath());
                entry.setVideos(store.getCachedVideos(folderKey(server.get().getId(), child.getPath())).orElse(List.of()));
                entry.setLastScannedAt(System.currentTimeMillis());
                out.add(entry);
            }
            return out;
        }
    }

    /** Scan every library root and emit entries as they are discovered. */
    public void scanAllStreaming(Consumer<AnimeEntry> onItem) {
        List<LibraryRoot> roots = store.listLibraryRoots();
        List<AnimeEntry> needsMetadata = new ArrayList<>();

        for (LibraryRoot root : roots) {
            List<AnimeEntry> scanned;
            try {
                scanned = scanRoot(root);
            } catch (Exception e) {
                continue;
            }
            for (AnimeEntry entry : scanned) {
                Optional<AnimeMetadata> cached = store.getCachedMetadata(folderKey(entry.getServerId(), entry.getPath()));
                cached.ifPresent(entry::setMetadata);
                onItem.accept(entry);
                if (entry.getMetadata() == null) needsMetadata.add(entry);
            }
            store.putAnimeEntries(root.getId(), scanned);
        }

        if (!needsMetadata.isEmpty()) {
            Thread t = new Thread(() -> enrichInBackground(needsMetadata, onItem), "library-enrich");
            t.setDaemon(true);
            t.start();
        }
    }

    private void enrichInBackground(List<AnimeEntry> entries, Consumer<AnimeEntry> onItem) {
        for (AnimeEntry entry : entries) {
            try {
                String query = JikanClient.normalizeFolderName(entry.getFolderName());
                if (query.isBlank()) continue;
                AnimeMetadata metadata = jikan.resolveBest(query);
                if (metadata == null) continue;
                store.cacheMetadata(folderKey(entry.getServerId(), entry.getPath()), metadata);
                entry.setMetadata(metadata);
                onItem.accept(entry);
            } catch (Exception ignored) {
                // continue with next entry
            }
        }
    }

    public AnimeEntry loadAnime(String serverId, String folderPath, String libraryRootId) {
        Optional<FtpServerConfig> server = store.getServer(serverId);
        if (server.isEmpty()) return null;
        String folderName = folderName(folderPath);
        String key = folderKey(serverId, folderPath);
        List<VideoFile> videos;
        try {
            videos = listFolderVideos(serverId, folderPath);
            store.cacheVideos(key, videos);
        } catch (Exception e) {
            videos = store.getCachedVideos(key).orElse(List.of());
        }
        AnimeMetadata metadata = store.getCachedMetadata(key).orElse(null);
        if (metadata == null) {
            metadata = jikan.resolveBest(JikanClient.normalizeFolderName(folderName));
            if (metadata != null) {
                store.cacheMetadata(key, metadata);
            }
        }
        AnimeEntry entry = new AnimeEntry();
        entry.setId(animeId(serverId, folderPath));
        entry.setServerId(serverId);
        entry.setLibraryRootId(libraryRootId);
        entry.setFolderName(folderName);
        entry.setPath(folderPath);
        entry.setVideos(videos);
        entry.setMetadata(metadata);
        entry.setLastScannedAt(System.currentTimeMillis());
        return entry;
    }

    public static String folderKey(String serverId, String folderPath) {
        return sha1(serverId + ":" + folderPath);
    }

    private static String folderName(String path) {
        if (path == null || path.isEmpty()) return "";
        String[] parts = path.split("/");
        for (int i = parts.length - 1; i >= 0; i--) {
            if (!parts[i].isBlank()) return parts[i];
        }
        return path;
    }

    private static String sha1(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] digest = md.digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
