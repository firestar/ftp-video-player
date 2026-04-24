package com.ftpanimeplayer.sync.controller;

import java.util.List;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ftpanimeplayer.sync.domain.FavoriteFolder;
import com.ftpanimeplayer.sync.persistence.LibraryStore;

/** Favorites. Mirrors {@code list/add/removeFavoriteFolder}. */
@RestController
@RequestMapping("/api/favorites")
public class FavoritesController {

    private final LibraryStore store;

    public FavoritesController(LibraryStore store) {
        this.store = store;
    }

    @GetMapping
    public List<FavoriteFolder> list() {
        return store.listFavorites();
    }

    @PostMapping
    public List<FavoriteFolder> add(@RequestBody FavoriteFolder fav) {
        if (fav.getAddedAt() == 0) fav.setAddedAt(System.currentTimeMillis());
        store.addFavorite(fav);
        return store.listFavorites();
    }

    @DeleteMapping
    public ResponseEntity<List<FavoriteFolder>> remove(@RequestParam String serverId, @RequestParam String path) {
        store.removeFavorite(serverId, path);
        return ResponseEntity.ok(store.listFavorites());
    }
}
