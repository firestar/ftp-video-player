# FTP Anime Player — Sync Server

A small Spring Boot 3 backend that stores the desktop app's SQLite database
(`ftp-anime-player.db`) and its poster/thumbnail caches so they can roam between
machines. The Electron app (see the **Sync** tab) authenticates with HTTP
Basic using credentials configured on the server.

## Requirements

- JDK 17+
- Maven 3.9+ (or use your own wrapper)

## Run

```bash
cd server
mvn spring-boot:run
```

By default the server listens on `:8080`, stores data under `./data`, and ships
with a single user `admin` / `changeme`. Override any of those via env vars or
a `--spring.config.location=...` override.

### Configuration

Edit `src/main/resources/application.yml` (or supply env vars):

| Key                   | Env var            | Default   | Notes                                                           |
| --------------------- | ------------------ | --------- | --------------------------------------------------------------- |
| `server.port`         | `SYNC_SERVER_PORT` | `8080`    | HTTP port.                                                      |
| `sync.data-dir`       | `SYNC_DATA_DIR`    | `./data`  | Root directory for per-user storage.                            |
| `sync.users[i].username` / `.password` | — | `admin` / `changeme` | Plain-text or `{bcrypt}` hashed passwords. |

On disk, each authenticated user gets an isolated tree:

```
<data-dir>/users/<username>/
  db/ftp-anime-player.db
  cache/posters/<sha1>.jpg
  cache/thumbnails/<sha1>.jpg
```

### Packaging

```bash
mvn clean package
java -jar target/sync-server-0.1.0.jar
```

Put the jar behind a reverse proxy (nginx, Caddy) that terminates TLS before
exposing the server to the internet — HTTP Basic credentials travel in the
request headers and MUST only be sent over TLS in production.

## HTTP API

All routes live under `/api`. `/api/health` is public; everything else requires
HTTP Basic authentication.

| Method | Path                               | Description                                        |
| ------ | ---------------------------------- | -------------------------------------------------- |
| GET    | `/api/health`                      | Liveness probe.                                    |
| GET    | `/api/auth/me`                     | Verify credentials; returns the authenticated user.|
| GET    | `/api/sync/db/meta`                | `{ exists, size, lastModifiedMs }`.                |
| GET    | `/api/sync/db`                     | Download the stored SQLite file.                   |
| PUT    | `/api/sync/db`                     | Upload the SQLite file (`application/octet-stream`).|
| GET    | `/api/sync/cache/{kind}`           | List cache files (`posters` or `thumbnails`).      |
| GET    | `/api/sync/cache/{kind}/{name}`    | Download a single cache file.                      |
| PUT    | `/api/sync/cache/{kind}/{name}`    | Upload a single cache file.                        |
| DELETE | `/api/sync/cache/{kind}/{name}`    | Remove a single cache file.                        |

### Example: upload the DB

```bash
curl -u admin:changeme \
     -X PUT \
     -H 'Content-Type: application/octet-stream' \
     --data-binary @~/Library/Application\ Support/ftp-anime-player/ftp-anime-player.db \
     http://localhost:8080/api/sync/db
```

## Tests

```bash
cd server
mvn test
```

The bundled integration test spins up a real Spring context, exercises the auth
layer, round-trips DB + cache uploads, and checks that path-traversal attempts
return `400`.

## Client integration

In the Electron app, open **Sync** in the sidebar:

1. Enter the base URL (e.g. `http://localhost:8080`) plus the username /
   password you configured on the server.
2. Click **Test** to verify credentials and see the current remote state.
3. **Save** the credentials (they're stored in the local SQLite DB).
4. Use **Push to server** or **Pull from server** to sync.

Push uploads the local DB plus any poster/thumbnail the server doesn't already
have (matched by filename + size, since both caches are content-addressable
SHA1 hashes). Pull does the inverse and **overwrites** local data with what's
on the server.
