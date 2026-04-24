package com.ftpanimeplayer.sync.controller;

import java.util.List;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.ftpanimeplayer.sync.domain.AnimeEntry;
import com.ftpanimeplayer.sync.library.LibraryScanner;
import com.ftpanimeplayer.sync.persistence.LibraryStore;

/**
 * Library scan + load endpoints. Scan streams SSE events to the client —
 * mirrors {@code onLibraryItem/onLibraryDone} in {@code src/shared/types.ts}.
 */
@RestController
@RequestMapping("/api/library")
public class LibraryController {

    private final LibraryScanner scanner;
    private final LibraryStore store;

    public LibraryController(LibraryScanner scanner, LibraryStore store) {
        this.scanner = scanner;
        this.store = store;
    }

    @GetMapping
    public List<AnimeEntry> cached() {
        return store.getAllAnimeEntries();
    }

    @PostMapping(value = "/scan", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter scan() {
        SseEmitter emitter = new SseEmitter(0L);
        Thread runner = new Thread(() -> {
            try {
                scanner.scanAllStreaming(entry -> {
                    try {
                        emitter.send(SseEmitter.event().name("library-item").data(entry));
                    } catch (Exception ignored) { /* client closed */ }
                });
                emitter.send(SseEmitter.event().name("library-done").data(""));
                emitter.complete();
            } catch (Exception e) {
                emitter.completeWithError(e);
            }
        }, "library-scan");
        runner.setDaemon(true);
        runner.start();
        return emitter;
    }

    @GetMapping("/anime")
    public ResponseEntity<AnimeEntry> loadAnime(@RequestParam String serverId,
                                                @RequestParam String path,
                                                @RequestParam String libraryRootId) {
        AnimeEntry entry = scanner.loadAnime(serverId, path, libraryRootId);
        return entry == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(entry);
    }
}
