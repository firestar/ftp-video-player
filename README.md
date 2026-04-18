# FTP Anime Player

A Mac desktop app that browses anime collections stored on FTP / FTPS / SFTP
servers, enriches each folder with metadata from MyAnimeList, and plays the
videos directly from the remote server. Thumbnails are generated on demand with
`ffmpeg`.

## Features

- **Library index view** — every anime folder on every server is shown as a
  poster grid with title, year, type, and score from MyAnimeList.
- **Multiple servers** — add FTP, FTPS (implicit TLS), and SFTP servers with a
  connection test. Credentials persist locally via `electron-store`.
- **Per-server library roots** — browse each server and point the app at
  folders like `/Anime/Movies` or `/Anime/TV`. Sub-folders become anime
  entries.
- **Automatic metadata** — folder names are normalized (release tags, hashes,
  quality markers stripped) and searched on
  [Jikan](https://docs.api.jikan.moe/) (MyAnimeList REST API). Matches are
  cached and can be overridden by searching again.
- **Thumbnails** — `fluent-ffmpeg` + `ffmpeg-static` generate a poster frame
  for each video by fetching the first ~24 MB over FTP.
- **Streaming playback** — a local HTTP proxy inside the main process relays
  byte-range requests from the `<video>` element down to FTP, so seeking works.

## Stack

- **Electron 30** + **Vite** + **React 18** + **TypeScript 5**
- `basic-ftp` (FTP / FTPS) and `ssh2-sftp-client` (SFTP)
- `fluent-ffmpeg` with bundled `ffmpeg-static` + `ffprobe-static`
- `electron-store` for persistent config
- Jikan v4 API for anime metadata (no API key required)

## Layout

```
src/
├── main/            # Electron main process
│   ├── index.ts       entry, window, local:// protocol
│   ├── ipc.ts         renderer <-> main handlers
│   ├── store.ts       persistent config
│   ├── ftp/           unified FTP/SFTP client
│   ├── anime.ts       Jikan search + poster cache
│   ├── thumbnail.ts   ffmpeg thumbnail generation
│   ├── library.ts     scan roots into anime entries
│   └── stream-server.ts  local HTTP for <video> streaming
├── preload/
│   └── index.ts      contextBridge → window.api
├── renderer/
│   └── src/
│       ├── pages/    Library, Servers, Anime, Player
│       └── components/ServerForm, LibraryRootPicker
└── shared/
    └── types.ts      shared types + Api interface
```

## Running

```bash
npm install
npm run dev         # hot-reload dev window
npm run typecheck   # type check main+renderer
npm run dist:mac    # build .dmg for arm64 + x64
```

The packaged `.app` lives in `dist/`.

## Usage

1. Launch the app → **Servers** tab → **Add server**.
2. Fill in host/port/username/password and pick the protocol. Use **Test** to
   verify.
3. For each server, click **Add folder** and browse to something like
   `/Anime/Movies`. Each direct sub-folder will become an anime entry.
4. Switch to **Library** — scanning + metadata lookup happens automatically.
5. Click an anime for the detail view with video thumbnails, then **Play** to
   stream.

## Player & codec support

Playback uses [Video.js](https://videojs.com/) as the frontend player and the
local stream server in `src/main/stream-server.ts` exposes four HTTP
endpoints per registered stream:

- `/stream/:token` — raw byte-range passthrough from the FTP source.
- `/probe/:token` — JSON from `ffprobe`: container, codecs, duration, and an
  enumeration of embedded subtitle tracks.
- `/transcode/:token[?seek=N]` — on-the-fly transcode to fragmented MP4
  (H.264 + AAC, `yuv420p`) using `ffmpeg`, suitable for HEVC/H.265, AV1,
  AC3/EAC3/DTS audio, and other codecs Chromium does not natively decode.
- `/subtitle/:token/:streamIndex` — extracts an embedded subtitle track and
  converts it to WebVTT so the browser can render it as a `<track>`.

On open, the player probes the file and picks **Direct** when the codecs are
Chromium-compatible (`h264`/`vp8`/`vp9`/`av1` + `aac`/`mp3`/`opus`/`vorbis`/
`flac` in `mp4`/`m4v`/`webm`/`mkv`) or **Transcode** otherwise. A toolbar
toggle lets the user switch manually. If direct playback errors on an
unsupported codec mid-session, the player falls back to transcode
automatically.

Non-browser-native containers (`avi`, `mov`, `ts`, `wmv`, `flv`) always go
through the transcode path. AVI specifically keeps its `idx1` chunk at the
end of the file, so the stream server advertises byte-range support and
ffmpeg is invoked with `-seekable 1` so the index can be fetched on demand.

Embedded text subtitle tracks (SRT, ASS/SSA, mov_text, etc.) are converted to
WebVTT on the fly and exposed through the Video.js captions menu. Bitmap
formats (PGS, DVD, DVB) can't be served as WebVTT and are hidden from the
menu; they require burn-in via the transcode endpoint (`?sub=<streamIndex>`)
to be visible.

## Caches

- `app.getPath('userData')/posters/` — poster images from MyAnimeList
- `app.getPath('userData')/thumbnails/` — ffmpeg-generated video thumbnails
- `app.getPath('temp')/ftp-anime-head/` — short-lived head-of-file downloads

Clearing the folder cache is safe; files are regenerated as needed.
