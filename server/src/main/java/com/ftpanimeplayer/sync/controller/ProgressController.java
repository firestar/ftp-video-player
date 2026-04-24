package com.ftpanimeplayer.sync.controller;

import java.util.List;
import java.util.Optional;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ftpanimeplayer.sync.domain.VideoProgress;
import com.ftpanimeplayer.sync.persistence.LibraryStore;

/** Resume positions. Mirrors {@code getVideoProgress/setVideoProgress/list*}. */
@RestController
@RequestMapping("/api/progress")
public class ProgressController {

    private final LibraryStore store;

    public ProgressController(LibraryStore store) {
        this.store = store;
    }

    @GetMapping
    public ResponseEntity<VideoProgress> get(@RequestParam String serverId, @RequestParam String path) {
        Optional<VideoProgress> p = store.getProgress(serverId, path);
        return p.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<Void> set(@RequestBody VideoProgress progress) {
        store.setProgress(progress);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/all")
    public List<VideoProgress> list() {
        return store.listProgress();
    }
}
