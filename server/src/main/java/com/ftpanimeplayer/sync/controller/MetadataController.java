package com.ftpanimeplayer.sync.controller;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ftpanimeplayer.sync.domain.AnimeMetadata;
import com.ftpanimeplayer.sync.library.JikanClient;
import com.ftpanimeplayer.sync.library.LibraryScanner;
import com.ftpanimeplayer.sync.persistence.LibraryStore;

/**
 * Metadata search + override + refresh. Mirrors the
 * {@code searchAnime/overrideMetadata/refreshMetadata} API on the desktop.
 */
@RestController
@RequestMapping("/api/metadata")
public class MetadataController {

    private final JikanClient jikan;
    private final LibraryStore store;

    public MetadataController(JikanClient jikan, LibraryStore store) {
        this.jikan = jikan;
        this.store = store;
    }

    @GetMapping("/search")
    public List<AnimeMetadata> search(@RequestParam("q") String query) {
        return jikan.search(query);
    }

    public static final class OverrideRequest {
        public String serverId;
        public String path;
        public AnimeMetadata metadata;
    }

    @PostMapping("/override")
    public AnimeMetadata override(@RequestBody OverrideRequest req) {
        AnimeMetadata metadata = req.metadata;
        if (metadata != null && metadata.getImageUrl() != null && metadata.getPosterPath() == null) {
            String local = jikan.downloadPoster(metadata.getImageUrl(), LibraryScanner.folderKey(req.serverId, req.path));
            if (local != null) metadata.setPosterPath(local);
        }
        if (metadata != null) {
            store.cacheMetadata(LibraryScanner.folderKey(req.serverId, req.path), metadata);
        }
        return metadata;
    }

    public static final class RefreshRequest {
        public String serverId;
        public String path;
        public String folderName;
    }

    @PostMapping("/refresh")
    public AnimeMetadata refresh(@RequestBody RefreshRequest req) {
        AnimeMetadata metadata = jikan.resolveBest(JikanClient.normalizeFolderName(req.folderName));
        if (metadata != null) {
            store.cacheMetadata(LibraryScanner.folderKey(req.serverId, req.path), metadata);
        }
        return metadata;
    }
}
