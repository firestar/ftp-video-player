package com.ftpanimeplayer.sync.controller;

import java.util.List;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ftpanimeplayer.sync.domain.ConnectionTestResult;
import com.ftpanimeplayer.sync.domain.FtpServerConfig;
import com.ftpanimeplayer.sync.domain.LibraryRoot;
import com.ftpanimeplayer.sync.domain.RemoteEntry;
import com.ftpanimeplayer.sync.ftp.FtpClient;
import com.ftpanimeplayer.sync.ftp.FtpClientFactory;
import com.ftpanimeplayer.sync.persistence.LibraryStore;

/**
 * FTP server management + live directory browsing. Matches the
 * {@code listServers/upsertServer/removeServer/testServer/browse/*LibraryRoot*}
 * family in {@code src/shared/types.ts}.
 */
@RestController
@RequestMapping("/api")
public class ServerController {

    private final LibraryStore store;
    private final FtpClientFactory factory;

    public ServerController(LibraryStore store, FtpClientFactory factory) {
        this.store = store;
        this.factory = factory;
    }

    @GetMapping("/servers")
    public List<FtpServerConfig> listServers() {
        return store.listServers();
    }

    @PostMapping("/servers")
    public FtpServerConfig upsertServer(@RequestBody FtpServerConfig cfg) {
        return store.upsertServer(cfg);
    }

    @DeleteMapping("/servers/{id}")
    public ResponseEntity<Void> removeServer(@PathVariable String id) {
        store.removeServer(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/servers/test")
    public ConnectionTestResult testServer(@RequestBody FtpServerConfig cfg) {
        String err = factory.testConnection(cfg);
        return new ConnectionTestResult(err == null, err);
    }

    @GetMapping("/servers/{id}/browse")
    public List<RemoteEntry> browse(@PathVariable String id, @RequestParam String path) throws Exception {
        FtpServerConfig cfg = store.getServer(id).orElseThrow(() -> new IllegalArgumentException("unknown server " + id));
        try (FtpClient client = factory.open(cfg)) {
            return client.list(path);
        }
    }

    @GetMapping("/library-roots")
    public List<LibraryRoot> listLibraryRoots() {
        return store.listLibraryRoots();
    }

    @PostMapping("/library-roots")
    public LibraryRoot addLibraryRoot(@RequestBody LibraryRoot root) {
        return store.addLibraryRoot(root);
    }

    @DeleteMapping("/library-roots/{id}")
    public ResponseEntity<Void> removeLibraryRoot(@PathVariable String id) {
        store.removeLibraryRoot(id);
        return ResponseEntity.noContent().build();
    }
}
