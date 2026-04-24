# FTP Anime Player — Backend server

Spring Boot 3 backend that owns FTP/SFTP connections, Jikan metadata lookup,
ffmpeg-based HLS transcoding, and the existing SQLite + poster/thumbnail
sync for the desktop app. Every client (desktop, iOS, iPadOS, tvOS, Android,
Android TV) talks to this service — they never connect to FTP directly.

## Requirements

- JDK 17+
- Maven 3.9+
- `ffmpeg` and `ffprobe` on `PATH` (for probing + HLS transcoding).

## Run

```bash
cd server
mvn spring-boot:run
```

By default the server listens on `:8080`, stores data under `./data`, and
ships with a single user `admin` / `changeme`. Override via env vars or a
`--spring.config.location=...` override.

### Configuration

Edit `src/main/resources/application.yml` (or supply env vars):

| Key                         | Env var              | Default               | Notes                                                           |
| --------------------------- | -------------------- | --------------------- | --------------------------------------------------------------- |
| `server.port`               | `SYNC_SERVER_PORT`   | `8080`                | HTTP port.                                                      |
| `sync.data-dir`             | `SYNC_DATA_DIR`      | `./data`              | Root directory for per-user storage.                            |
| `sync.users[i].username`/`.password` | —           | `admin`/`changeme`    | Plain-text or `{bcrypt}` hashed passwords.                      |
| `player.ffmpeg-path`        | `PLAYER_FFMPEG`      | `ffmpeg`              | Absolute path or name on `$PATH`.                               |
| `player.ffprobe-path`       | `PLAYER_FFPROBE`     | `ffprobe`             | —                                                               |
| `player.transcode-dir`      | `PLAYER_TRANSCODE_DIR` | `./data/transcode`  | Working dir for HLS segments. Wiped on startup.                 |
| `player.jikan-base-url`     | `PLAYER_JIKAN_URL`   | `https://api.jikan.moe/v4` | Swap for a self-hosted Jikan mirror if you have one.          |
| `player.max-concurrent-transcodes` | `PLAYER_MAX_TRANSCODES` | `2`            | Cap on simultaneous ffmpeg HLS sessions.                        |

On disk each user gets an isolated tree:

```
<data-dir>/users/<username>/
  db/ftp-anime-player.db
  cache/posters/<sha1>.jpg
  cache/thumbnails/<sha1>.jpg
<data-dir>/transcode/<token>/           # HLS segments, auto-wiped on startup
```

## HTTP API

All routes live under `/api`. `/api/health` is public; everything else
requires HTTP Basic authentication.

### Sync (existing)

| Method | Path                                | Description                                         |
| ------ | ----------------------------------- | --------------------------------------------------- |
| GET    | `/api/health`                       | Liveness probe.                                     |
| GET    | `/api/auth/me`                      | Verify credentials; returns the authenticated user. |
| GET/PUT | `/api/sync/db`                     | Download / upload the stored SQLite file.           |
| GET/PUT/DELETE | `/api/sync/cache/{kind}/…`  | Poster / thumbnail cache.                           |

### Servers & library

| Method | Path                                    | Description                           |
| ------ | --------------------------------------- | ------------------------------------- |
| GET    | `/api/servers`                          | List configured FTP servers.          |
| POST   | `/api/servers`                          | Upsert server (id generated).         |
| DELETE | `/api/servers/{id}`                     | Remove + cascade-delete its roots.    |
| POST   | `/api/servers/test`                     | Probe credentials (body = full cfg).  |
| GET    | `/api/servers/{id}/browse?path=`        | Live FTP directory listing.           |
| GET/POST/DELETE | `/api/library-roots`           | Library root CRUD.                    |
| GET    | `/api/library`                          | Cached anime entries.                 |
| POST   | `/api/library/scan` (SSE)               | `library-item` + `library-done` events as the scan + metadata pipeline runs. |
| GET    | `/api/library/anime?serverId=&path=&libraryRootId=` | Hydrate one anime.        |

### Metadata

| Method | Path                                | Description                                     |
| ------ | ----------------------------------- | ----------------------------------------------- |
| GET    | `/api/metadata/search?q=`           | Jikan search — up to 10 hits.                  |
| POST   | `/api/metadata/override`            | Commit a user-picked MAL result to the cache.  |
| POST   | `/api/metadata/refresh`             | Re-derive from a folder name.                  |

### Streaming (mobile/TV use the HLS URL; desktop can continue on direct)

| Method | Path                                         | Description                                 |
| ------ | -------------------------------------------- | ------------------------------------------- |
| POST   | `/api/stream/register`                       | `{ token, directUrl, hlsUrl, probeUrl, … }` |
| DELETE | `/api/stream/{token}`                        | Tear down + free ffmpeg.                    |
| GET    | `/api/stream/{token}/probe`                  | ffprobe JSON.                               |
| GET    | `/api/stream/{token}/direct`                 | Byte-range passthrough from FTP.            |
| GET    | `/api/stream/{token}/hls/master.m3u8`        | Kicks off ffmpeg and returns the playlist.  |
| GET    | `/api/stream/{token}/hls/media.m3u8`         | Media playlist (polled by ffmpeg).          |
| GET    | `/api/stream/{token}/hls/seg_XXXXX.ts`       | Individual HLS segment.                     |

### Progress + favorites

| Method | Path                              | Description                           |
| ------ | --------------------------------- | ------------------------------------- |
| GET    | `/api/progress?serverId=&path=`   | Resume position for a single video.   |
| POST   | `/api/progress`                   | Upsert progress.                      |
| GET    | `/api/progress/all`               | All known progress rows.              |
| GET/POST/DELETE | `/api/favorites`         | Favorite folders.                     |

## Packaging

```bash
mvn clean package
java -jar target/sync-server-0.2.0.jar
```

## Tests

```bash
cd server
mvn test
```

The existing integration tests exercise the sync endpoints; the new
FTP/streaming paths are exercised manually today — run `mvn spring-boot:run`,
`curl` `/api/servers` to add a test server, register a stream and fetch
`hls/master.m3u8` in VLC.
