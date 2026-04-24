package com.ftpanimeplayer.sync.persistence;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ftpanimeplayer.sync.config.SyncProperties;
import com.ftpanimeplayer.sync.domain.AnimeEntry;
import com.ftpanimeplayer.sync.domain.AnimeMetadata;
import com.ftpanimeplayer.sync.domain.FavoriteFolder;
import com.ftpanimeplayer.sync.domain.FtpServerConfig;
import com.ftpanimeplayer.sync.domain.LibraryRoot;
import com.ftpanimeplayer.sync.domain.VideoFile;
import com.ftpanimeplayer.sync.domain.VideoProgress;

import jakarta.annotation.PostConstruct;

/**
 * Persists all the state the desktop app keeps in {@code src/main/store.ts}:
 * server configs, library roots, cached metadata, cached video lists,
 * favorites and resume positions. Uses one SQLite file per authenticated
 * user under {@code <data-dir>/users/<username>/db/ftp-anime-player.db}.
 *
 * <p>For simplicity there's a single shared file under the first configured
 * user; if you need multi-tenant isolation beyond that, open a connection
 * per user instead. (The existing sync flow has the same single-file
 * assumption.)
 */
@Component
public class LibraryStore {

    private final SyncProperties syncProperties;
    private final ObjectMapper json = new ObjectMapper();
    private Path dbPath;

    public LibraryStore(SyncProperties syncProperties) {
        this.syncProperties = syncProperties;
    }

    @PostConstruct
    void init() {
        String user = syncProperties.getUsers().isEmpty()
                ? "admin"
                : syncProperties.getUsers().get(0).getUsername();
        Path root = Paths.get(syncProperties.getDataDir(), "users", user, "db");
        try {
            Files.createDirectories(root);
        } catch (Exception e) {
            throw new RuntimeException("cannot create db dir " + root, e);
        }
        this.dbPath = root.resolve("ftp-anime-player.db");
        try (Connection c = connect(); Statement s = c.createStatement()) {
            s.executeUpdate("""
                CREATE TABLE IF NOT EXISTS servers (
                  id TEXT PRIMARY KEY,
                  json TEXT NOT NULL
                )""");
            s.executeUpdate("""
                CREATE TABLE IF NOT EXISTS library_roots (
                  id TEXT PRIMARY KEY,
                  server_id TEXT NOT NULL,
                  json TEXT NOT NULL
                )""");
            s.executeUpdate("""
                CREATE TABLE IF NOT EXISTS metadata_cache (
                  folder_key TEXT PRIMARY KEY,
                  json TEXT NOT NULL
                )""");
            s.executeUpdate("""
                CREATE TABLE IF NOT EXISTS video_cache (
                  folder_key TEXT PRIMARY KEY,
                  json TEXT NOT NULL
                )""");
            s.executeUpdate("""
                CREATE TABLE IF NOT EXISTS anime_cache (
                  anime_id TEXT PRIMARY KEY,
                  library_root_id TEXT NOT NULL,
                  json TEXT NOT NULL
                )""");
            s.executeUpdate("""
                CREATE TABLE IF NOT EXISTS video_progress (
                  server_id TEXT NOT NULL,
                  path TEXT NOT NULL,
                  json TEXT NOT NULL,
                  PRIMARY KEY (server_id, path)
                )""");
            s.executeUpdate("""
                CREATE TABLE IF NOT EXISTS favorites (
                  server_id TEXT NOT NULL,
                  path TEXT NOT NULL,
                  added_at INTEGER NOT NULL,
                  json TEXT NOT NULL,
                  PRIMARY KEY (server_id, path)
                )""");
        } catch (SQLException e) {
            throw new RuntimeException("cannot initialize sqlite schema", e);
        }
    }

    /** Exposed for the sync layer — {@code /api/sync/db} writes to this file. */
    public File dbFile() {
        return dbPath.toFile();
    }

    private Connection connect() throws SQLException {
        return DriverManager.getConnection("jdbc:sqlite:" + dbPath.toAbsolutePath());
    }

    // ------------------------------------------------------------- servers

    public List<FtpServerConfig> listServers() {
        return loadAll("SELECT json FROM servers ORDER BY id", FtpServerConfig.class);
    }

    public Optional<FtpServerConfig> getServer(String id) {
        return loadOne("SELECT json FROM servers WHERE id = ?", FtpServerConfig.class, id);
    }

    public FtpServerConfig upsertServer(FtpServerConfig cfg) {
        if (cfg.getId() == null || cfg.getId().isBlank()) {
            cfg.setId(UUID.randomUUID().toString());
        }
        try (Connection c = connect();
             PreparedStatement ps = c.prepareStatement(
                     "INSERT INTO servers(id, json) VALUES(?, ?) " +
                     "ON CONFLICT(id) DO UPDATE SET json = excluded.json")) {
            ps.setString(1, cfg.getId());
            ps.setString(2, json.writeValueAsString(cfg));
            ps.executeUpdate();
            return cfg;
        } catch (Exception e) {
            throw new RuntimeException("upsertServer failed", e);
        }
    }

    public void removeServer(String id) {
        execute("DELETE FROM servers WHERE id = ?", id);
        execute("DELETE FROM library_roots WHERE server_id = ?", id);
    }

    // -------------------------------------------------------- library roots

    public List<LibraryRoot> listLibraryRoots() {
        return loadAll("SELECT json FROM library_roots ORDER BY id", LibraryRoot.class);
    }

    public LibraryRoot addLibraryRoot(LibraryRoot root) {
        if (root.getId() == null || root.getId().isBlank()) {
            root.setId(UUID.randomUUID().toString());
        }
        try (Connection c = connect();
             PreparedStatement ps = c.prepareStatement(
                     "INSERT INTO library_roots(id, server_id, json) VALUES(?, ?, ?) " +
                     "ON CONFLICT(id) DO UPDATE SET server_id = excluded.server_id, json = excluded.json")) {
            ps.setString(1, root.getId());
            ps.setString(2, root.getServerId());
            ps.setString(3, json.writeValueAsString(root));
            ps.executeUpdate();
            return root;
        } catch (Exception e) {
            throw new RuntimeException("addLibraryRoot failed", e);
        }
    }

    public void removeLibraryRoot(String id) {
        execute("DELETE FROM library_roots WHERE id = ?", id);
    }

    // --------------------------------------------------------- anime cache

    public void putAnimeEntries(String libraryRootId, List<AnimeEntry> entries) {
        try (Connection c = connect()) {
            c.setAutoCommit(false);
            try (PreparedStatement del = c.prepareStatement(
                        "DELETE FROM anime_cache WHERE library_root_id = ?");
                 PreparedStatement ins = c.prepareStatement(
                        "INSERT INTO anime_cache(anime_id, library_root_id, json) VALUES(?, ?, ?)")) {
                del.setString(1, libraryRootId);
                del.executeUpdate();
                for (AnimeEntry e : entries) {
                    ins.setString(1, e.getId());
                    ins.setString(2, libraryRootId);
                    ins.setString(3, json.writeValueAsString(e));
                    ins.addBatch();
                }
                ins.executeBatch();
            }
            c.commit();
        } catch (Exception e) {
            throw new RuntimeException("putAnimeEntries failed", e);
        }
    }

    public List<AnimeEntry> getAllAnimeEntries() {
        return loadAll("SELECT json FROM anime_cache ORDER BY anime_id", AnimeEntry.class);
    }

    // ------------------------------------------------------ metadata cache

    public Optional<AnimeMetadata> getCachedMetadata(String folderKey) {
        return loadOne("SELECT json FROM metadata_cache WHERE folder_key = ?", AnimeMetadata.class, folderKey);
    }

    public void cacheMetadata(String folderKey, AnimeMetadata metadata) {
        try (Connection c = connect();
             PreparedStatement ps = c.prepareStatement(
                     "INSERT INTO metadata_cache(folder_key, json) VALUES(?, ?) " +
                     "ON CONFLICT(folder_key) DO UPDATE SET json = excluded.json")) {
            ps.setString(1, folderKey);
            ps.setString(2, json.writeValueAsString(metadata));
            ps.executeUpdate();
        } catch (Exception e) {
            throw new RuntimeException("cacheMetadata failed", e);
        }
    }

    // --------------------------------------------------------- video cache

    public Optional<List<VideoFile>> getCachedVideos(String folderKey) {
        try (Connection c = connect();
             PreparedStatement ps = c.prepareStatement("SELECT json FROM video_cache WHERE folder_key = ?")) {
            ps.setString(1, folderKey);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                VideoFile[] arr = json.readValue(rs.getString(1), VideoFile[].class);
                return Optional.of(List.of(arr));
            }
        } catch (Exception e) {
            throw new RuntimeException("getCachedVideos failed", e);
        }
    }

    public void cacheVideos(String folderKey, List<VideoFile> videos) {
        try (Connection c = connect();
             PreparedStatement ps = c.prepareStatement(
                     "INSERT INTO video_cache(folder_key, json) VALUES(?, ?) " +
                     "ON CONFLICT(folder_key) DO UPDATE SET json = excluded.json")) {
            ps.setString(1, folderKey);
            ps.setString(2, json.writeValueAsString(videos));
            ps.executeUpdate();
        } catch (Exception e) {
            throw new RuntimeException("cacheVideos failed", e);
        }
    }

    // ------------------------------------------------------- video progress

    public Optional<VideoProgress> getProgress(String serverId, String path) {
        try (Connection c = connect();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT json FROM video_progress WHERE server_id = ? AND path = ?")) {
            ps.setString(1, serverId);
            ps.setString(2, path);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                return Optional.of(json.readValue(rs.getString(1), VideoProgress.class));
            }
        } catch (Exception e) {
            throw new RuntimeException("getProgress failed", e);
        }
    }

    public void setProgress(VideoProgress progress) {
        try (Connection c = connect();
             PreparedStatement ps = c.prepareStatement(
                     "INSERT INTO video_progress(server_id, path, json) VALUES(?, ?, ?) " +
                     "ON CONFLICT(server_id, path) DO UPDATE SET json = excluded.json")) {
            ps.setString(1, progress.getServerId());
            ps.setString(2, progress.getPath());
            ps.setString(3, json.writeValueAsString(progress));
            ps.executeUpdate();
        } catch (Exception e) {
            throw new RuntimeException("setProgress failed", e);
        }
    }

    public List<VideoProgress> listProgress() {
        return loadAll("SELECT json FROM video_progress ORDER BY server_id, path", VideoProgress.class);
    }

    // -------------------------------------------------------------- favorites

    public List<FavoriteFolder> listFavorites() {
        return loadAll("SELECT json FROM favorites ORDER BY added_at DESC", FavoriteFolder.class);
    }

    public void addFavorite(FavoriteFolder fav) {
        try (Connection c = connect();
             PreparedStatement ps = c.prepareStatement(
                     "INSERT INTO favorites(server_id, path, added_at, json) VALUES(?, ?, ?, ?) " +
                     "ON CONFLICT(server_id, path) DO UPDATE SET added_at = excluded.added_at, json = excluded.json")) {
            ps.setString(1, fav.getServerId());
            ps.setString(2, fav.getPath());
            ps.setLong(3, fav.getAddedAt());
            ps.setString(4, json.writeValueAsString(fav));
            ps.executeUpdate();
        } catch (Exception e) {
            throw new RuntimeException("addFavorite failed", e);
        }
    }

    public void removeFavorite(String serverId, String path) {
        try (Connection c = connect();
             PreparedStatement ps = c.prepareStatement(
                     "DELETE FROM favorites WHERE server_id = ? AND path = ?")) {
            ps.setString(1, serverId);
            ps.setString(2, path);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException("removeFavorite failed", e);
        }
    }

    // ---------------------------------------------------------------- utils

    private <T> List<T> loadAll(String sql, Class<T> type) {
        try (Connection c = connect(); PreparedStatement ps = c.prepareStatement(sql)) {
            try (ResultSet rs = ps.executeQuery()) {
                List<T> out = new ArrayList<>();
                while (rs.next()) {
                    out.add(json.readValue(rs.getString(1), type));
                }
                return out;
            }
        } catch (Exception e) {
            throw new RuntimeException("loadAll failed: " + sql, e);
        }
    }

    private <T> Optional<T> loadOne(String sql, Class<T> type, String id) {
        try (Connection c = connect(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                return Optional.of(json.readValue(rs.getString(1), type));
            }
        } catch (Exception e) {
            throw new RuntimeException("loadOne failed: " + sql, e);
        }
    }

    private void execute(String sql, String arg) {
        try (Connection c = connect(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, arg);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException("execute failed: " + sql, e);
        }
    }

}
