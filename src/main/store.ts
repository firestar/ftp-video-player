import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import Database from 'better-sqlite3'
import type {
  AnimeEntry,
  AnimeMetadata,
  FavoriteFolder,
  FtpServerConfig,
  LibraryRoot,
  VideoFile,
  VideoProgress
} from '@shared/types'

const DB_FILE_NAME = 'ftp-anime-player.db'
const LEGACY_JSON_NAME = 'ftp-anime-player.json'

let dbInstance: Database.Database | undefined

function getDb(): Database.Database {
  if (dbInstance) return dbInstance
  const userData = app.getPath('userData')
  fs.mkdirSync(userData, { recursive: true })
  const dbPath = path.join(userData, DB_FILE_NAME)
  const existed = fs.existsSync(dbPath)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  if (!existed) migrateFromElectronStore(db, path.join(userData, LEGACY_JSON_NAME))
  dbInstance = db
  return db
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      secure INTEGER,
      allow_self_signed INTEGER,
      max_concurrent_connections INTEGER,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS library_roots (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      path TEXT NOT NULL,
      label TEXT,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_library_roots_server ON library_roots(server_id);

    CREATE TABLE IF NOT EXISTS metadata_by_folder (
      folder_key TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS videos_by_folder (
      folder_key TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_entries (
      library_root_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      path TEXT NOT NULL,
      last_scanned_at INTEGER,
      position INTEGER NOT NULL DEFAULT 0,
      json TEXT NOT NULL,
      PRIMARY KEY (library_root_id, entry_id)
    );
    CREATE INDEX IF NOT EXISTS idx_library_entries_root ON library_entries(library_root_id);

    CREATE TABLE IF NOT EXISTS video_progress (
      key TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      position_seconds REAL NOT NULL,
      duration_seconds REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      video_name TEXT NOT NULL,
      anime_title TEXT NOT NULL,
      poster_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_video_progress_updated ON video_progress(updated_at DESC);

    CREATE TABLE IF NOT EXISTS favorite_folders (
      server_id TEXT NOT NULL,
      path TEXT NOT NULL,
      library_root_id TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (server_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_favorite_folders_server ON favorite_folders(server_id);
  `)

  // Additive migrations for columns introduced after initial schema.
  const serverCols = db.prepare('PRAGMA table_info(servers)').all() as { name: string }[]
  if (!serverCols.some((c) => c.name === 'max_concurrent_connections')) {
    db.exec('ALTER TABLE servers ADD COLUMN max_concurrent_connections INTEGER')
  }
}

function migrateFromElectronStore(db: Database.Database, jsonPath: string): void {
  if (!fs.existsSync(jsonPath)) return
  let raw: string
  try {
    raw = fs.readFileSync(jsonPath, 'utf8')
  } catch (err) {
    console.warn('[store] failed to read legacy electron-store file', err)
    return
  }
  if (!raw.trim()) return
  let parsed: Partial<{
    servers: FtpServerConfig[]
    libraryRoots: LibraryRoot[]
    metadataByFolder: Record<string, AnimeMetadata>
    entriesByRoot: Record<string, AnimeEntry[]>
    videosByFolder: Record<string, VideoFile[]>
    progressByVideo: Record<string, VideoProgress>
    favoriteFolders: FavoriteFolder[]
  }>
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.warn('[store] legacy electron-store file is not valid JSON', err)
    return
  }

  const tx = db.transaction(() => {
    const servers = parsed.servers ?? []
    const insertServer = db.prepare(
      `INSERT OR REPLACE INTO servers
         (id, name, protocol, host, port, username, password, secure, allow_self_signed, max_concurrent_connections, position)
       VALUES
         (@id, @name, @protocol, @host, @port, @username, @password, @secure, @allow_self_signed, @max_concurrent_connections, @position)`
    )
    servers.forEach((s, i) => insertServer.run(serverToRow(s, i)))

    const roots = parsed.libraryRoots ?? []
    const insertRoot = db.prepare(
      `INSERT OR REPLACE INTO library_roots (id, server_id, path, label, position)
       VALUES (@id, @server_id, @path, @label, @position)`
    )
    roots.forEach((r, i) =>
      insertRoot.run({
        id: r.id,
        server_id: r.serverId,
        path: r.path,
        label: r.label ?? null,
        position: i
      })
    )

    const metadata = parsed.metadataByFolder ?? {}
    const insertMeta = db.prepare(
      `INSERT OR REPLACE INTO metadata_by_folder (folder_key, json) VALUES (?, ?)`
    )
    for (const [key, value] of Object.entries(metadata)) {
      insertMeta.run(key, JSON.stringify(value))
    }

    const videos = parsed.videosByFolder ?? {}
    const insertVideos = db.prepare(
      `INSERT OR REPLACE INTO videos_by_folder (folder_key, json) VALUES (?, ?)`
    )
    for (const [key, value] of Object.entries(videos)) {
      insertVideos.run(key, JSON.stringify(value))
    }

    const entriesByRoot = parsed.entriesByRoot ?? {}
    const insertEntry = db.prepare(
      `INSERT OR REPLACE INTO library_entries
       (library_root_id, entry_id, server_id, folder_name, path, last_scanned_at, position, json)
       VALUES (@library_root_id, @entry_id, @server_id, @folder_name, @path, @last_scanned_at, @position, @json)`
    )
    for (const [rootId, list] of Object.entries(entriesByRoot)) {
      list.forEach((e, i) => insertEntry.run(entryToRow(rootId, e, i)))
    }

    const progress = parsed.progressByVideo ?? {}
    const insertProgress = db.prepare(
      `INSERT OR REPLACE INTO video_progress
       (key, server_id, path, size, position_seconds, duration_seconds, updated_at, video_name, anime_title, poster_path)
       VALUES (@key, @server_id, @path, @size, @position_seconds, @duration_seconds, @updated_at, @video_name, @anime_title, @poster_path)`
    )
    for (const p of Object.values(progress)) {
      insertProgress.run(progressToRow(p))
    }

    const favorites = parsed.favoriteFolders ?? []
    const insertFav = db.prepare(
      `INSERT OR REPLACE INTO favorite_folders
       (server_id, path, library_root_id, added_at, position)
       VALUES (?, ?, ?, ?, ?)`
    )
    favorites.forEach((f, i) =>
      insertFav.run(f.serverId, f.path, f.libraryRootId, f.addedAt, i)
    )
  })
  try {
    tx()
    console.log('[store] migrated legacy electron-store data to SQLite')
  } catch (err) {
    console.error('[store] migration from electron-store failed', err)
  }
}

function serverToRow(s: FtpServerConfig, position: number): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    protocol: s.protocol,
    host: s.host,
    port: s.port,
    username: s.username,
    password: s.password,
    secure: s.secure ? 1 : 0,
    allow_self_signed: s.allowSelfSigned ? 1 : 0,
    max_concurrent_connections:
      typeof s.maxConcurrentConnections === 'number' && s.maxConcurrentConnections > 0
        ? s.maxConcurrentConnections
        : null,
    position
  }
}

function rowToServer(row: ServerRow): FtpServerConfig {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol as FtpServerConfig['protocol'],
    host: row.host,
    port: row.port,
    username: row.username,
    password: row.password,
    secure: !!row.secure,
    allowSelfSigned: !!row.allow_self_signed,
    maxConcurrentConnections:
      typeof row.max_concurrent_connections === 'number' && row.max_concurrent_connections > 0
        ? row.max_concurrent_connections
        : undefined
  }
}

function entryToRow(rootId: string, e: AnimeEntry, position: number): Record<string, unknown> {
  return {
    library_root_id: rootId,
    entry_id: e.id,
    server_id: e.serverId,
    folder_name: e.folderName,
    path: e.path,
    last_scanned_at: e.lastScannedAt ?? null,
    position,
    json: JSON.stringify(e)
  }
}

function progressToRow(p: VideoProgress): Record<string, unknown> {
  return {
    key: `${p.serverId}::${p.path}`,
    server_id: p.serverId,
    path: p.path,
    size: p.size,
    position_seconds: p.positionSeconds,
    duration_seconds: p.durationSeconds,
    updated_at: p.updatedAt,
    video_name: p.videoName,
    anime_title: p.animeTitle,
    poster_path: p.posterPath ?? null
  }
}

function rowToProgress(row: ProgressRow): VideoProgress {
  return {
    serverId: row.server_id,
    path: row.path,
    size: row.size,
    positionSeconds: row.position_seconds,
    durationSeconds: row.duration_seconds,
    updatedAt: row.updated_at,
    videoName: row.video_name,
    animeTitle: row.anime_title,
    posterPath: row.poster_path ?? undefined
  }
}

interface ServerRow {
  id: string
  name: string
  protocol: string
  host: string
  port: number
  username: string
  password: string
  secure: number | null
  allow_self_signed: number | null
  max_concurrent_connections: number | null
}

interface LibraryRootRow {
  id: string
  server_id: string
  path: string
  label: string | null
}

interface EntryRow {
  json: string
}

interface ProgressRow {
  server_id: string
  path: string
  size: number
  position_seconds: number
  duration_seconds: number
  updated_at: number
  video_name: string
  anime_title: string
  poster_path: string | null
}

interface FavoriteRow {
  server_id: string
  path: string
  library_root_id: string
  added_at: number
}

export function listServers(): FtpServerConfig[] {
  const rows = getDb()
    .prepare('SELECT * FROM servers ORDER BY position, name')
    .all() as ServerRow[]
  return rows.map(rowToServer)
}

export function getServer(id: string): FtpServerConfig | undefined {
  const row = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(id) as
    | ServerRow
    | undefined
  return row ? rowToServer(row) : undefined
}

export function upsertServer(input: Omit<FtpServerConfig, 'id'> & { id?: string }): FtpServerConfig {
  const db = getDb()
  const existingId = input.id
  if (existingId) {
    const current = db.prepare('SELECT * FROM servers WHERE id = ?').get(existingId) as
      | ServerRow
      | undefined
    if (current) {
      const merged = { ...rowToServer(current), ...input, id: existingId } as FtpServerConfig
      db.prepare(
        `UPDATE servers SET name = @name, protocol = @protocol, host = @host, port = @port,
         username = @username, password = @password, secure = @secure,
         allow_self_signed = @allow_self_signed,
         max_concurrent_connections = @max_concurrent_connections
         WHERE id = @id`
      ).run({
        id: merged.id,
        name: merged.name,
        protocol: merged.protocol,
        host: merged.host,
        port: merged.port,
        username: merged.username,
        password: merged.password,
        secure: merged.secure ? 1 : 0,
        allow_self_signed: merged.allowSelfSigned ? 1 : 0,
        max_concurrent_connections:
          typeof merged.maxConcurrentConnections === 'number' && merged.maxConcurrentConnections > 0
            ? merged.maxConcurrentConnections
            : null
      })
      return merged
    }
  }
  const created: FtpServerConfig = { ...input, id: existingId ?? randomUUID() } as FtpServerConfig
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM servers').get() as { count: number }
  db.prepare(
    `INSERT INTO servers
       (id, name, protocol, host, port, username, password, secure, allow_self_signed, max_concurrent_connections, position)
     VALUES
       (@id, @name, @protocol, @host, @port, @username, @password, @secure, @allow_self_signed, @max_concurrent_connections, @position)`
  ).run(serverToRow(created, count))
  return created
}

export function removeServer(id: string): void {
  const db = getDb()
  const tx = db.transaction(() => {
    const affectedRoots = db
      .prepare('SELECT id FROM library_roots WHERE server_id = ?')
      .all(id) as { id: string }[]
    db.prepare('DELETE FROM servers WHERE id = ?').run(id)
    db.prepare('DELETE FROM library_roots WHERE server_id = ?').run(id)
    const deleteEntries = db.prepare('DELETE FROM library_entries WHERE library_root_id = ?')
    for (const r of affectedRoots) deleteEntries.run(r.id)
  })
  tx()
}

export function listLibraryRoots(): LibraryRoot[] {
  const rows = getDb()
    .prepare('SELECT * FROM library_roots ORDER BY position, path')
    .all() as LibraryRootRow[]
  return rows.map((r) => ({
    id: r.id,
    serverId: r.server_id,
    path: r.path,
    label: r.label ?? undefined
  }))
}

export function addLibraryRoot(input: Omit<LibraryRoot, 'id'>): LibraryRoot {
  const db = getDb()
  const created: LibraryRoot = { ...input, id: randomUUID() }
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM library_roots').get() as {
    count: number
  }
  db.prepare(
    `INSERT INTO library_roots (id, server_id, path, label, position) VALUES (?, ?, ?, ?, ?)`
  ).run(created.id, created.serverId, created.path, created.label ?? null, count)
  return created
}

export function removeLibraryRoot(id: string): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM library_roots WHERE id = ?').run(id)
    db.prepare('DELETE FROM library_entries WHERE library_root_id = ?').run(id)
  })
  tx()
}

export function cacheMetadata(folderKey: string, metadata: AnimeMetadata): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO metadata_by_folder (folder_key, json) VALUES (?, ?)`)
    .run(folderKey, JSON.stringify(metadata))
}

export function getCachedMetadata(folderKey: string): AnimeMetadata | undefined {
  const row = getDb()
    .prepare('SELECT json FROM metadata_by_folder WHERE folder_key = ?')
    .get(folderKey) as { json: string } | undefined
  return row ? (JSON.parse(row.json) as AnimeMetadata) : undefined
}

export function clearCachedMetadata(folderKey: string): void {
  getDb().prepare('DELETE FROM metadata_by_folder WHERE folder_key = ?').run(folderKey)
}

export function getCachedEntriesForRoot(rootId: string): AnimeEntry[] {
  const rows = getDb()
    .prepare('SELECT json FROM library_entries WHERE library_root_id = ? ORDER BY position')
    .all(rootId) as EntryRow[]
  return rows.map((r) => JSON.parse(r.json) as AnimeEntry)
}

export function getAllCachedEntries(): AnimeEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT e.json FROM library_entries e
       INNER JOIN library_roots r ON r.id = e.library_root_id
       ORDER BY e.library_root_id, e.position`
    )
    .all() as EntryRow[]
  return rows.map((r) => JSON.parse(r.json) as AnimeEntry)
}

export function setCachedEntriesForRoot(rootId: string, entries: AnimeEntry[]): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM library_entries WHERE library_root_id = ?').run(rootId)
    const insert = db.prepare(
      `INSERT INTO library_entries
       (library_root_id, entry_id, server_id, folder_name, path, last_scanned_at, position, json)
       VALUES (@library_root_id, @entry_id, @server_id, @folder_name, @path, @last_scanned_at, @position, @json)`
    )
    entries.forEach((e, i) => insert.run(entryToRow(rootId, e, i)))
  })
  tx()
}

export function getCachedVideos(folderKey: string): VideoFile[] | undefined {
  const row = getDb()
    .prepare('SELECT json FROM videos_by_folder WHERE folder_key = ?')
    .get(folderKey) as { json: string } | undefined
  return row ? (JSON.parse(row.json) as VideoFile[]) : undefined
}

export function setCachedVideos(folderKey: string, videos: VideoFile[]): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO videos_by_folder (folder_key, json) VALUES (?, ?)`)
    .run(folderKey, JSON.stringify(videos))
}

// Progress is written ~100x/sec while a video plays. We keep the latest values
// in memory and flush dirty rows to SQLite on a debounce to avoid per-update
// write amplification (each flush is a single transaction).
const progressCache = new Map<string, VideoProgress>()
const progressDirty = new Set<string>()
let progressLoaded = false

function progressKey(serverId: string, remotePath: string): string {
  return `${serverId}::${remotePath}`
}

function ensureProgressLoaded(): void {
  if (progressLoaded) return
  const rows = getDb().prepare('SELECT * FROM video_progress').all() as ProgressRow[]
  for (const row of rows) {
    const p = rowToProgress(row)
    progressCache.set(progressKey(p.serverId, p.path), p)
  }
  progressLoaded = true
}

export function getVideoProgress(serverId: string, remotePath: string): VideoProgress | undefined {
  ensureProgressLoaded()
  return progressCache.get(progressKey(serverId, remotePath))
}

export function setVideoProgress(progress: VideoProgress): void {
  ensureProgressLoaded()
  const key = progressKey(progress.serverId, progress.path)
  progressCache.set(key, progress)
  progressDirty.add(key)
}

export function listVideoProgress(): VideoProgress[] {
  ensureProgressLoaded()
  return Array.from(progressCache.values())
}

export function flushVideoProgress(): void {
  if (progressDirty.size === 0) return
  const db = getDb()
  const insert = db.prepare(
    `INSERT OR REPLACE INTO video_progress
     (key, server_id, path, size, position_seconds, duration_seconds, updated_at, video_name, anime_title, poster_path)
     VALUES (@key, @server_id, @path, @size, @position_seconds, @duration_seconds, @updated_at, @video_name, @anime_title, @poster_path)`
  )
  const tx = db.transaction((keys: string[]) => {
    for (const key of keys) {
      const p = progressCache.get(key)
      if (p) insert.run(progressToRow(p))
    }
  })
  const keys = Array.from(progressDirty)
  progressDirty.clear()
  try {
    tx(keys)
  } catch (err) {
    console.error('[store] failed to flush video progress', err)
    for (const k of keys) progressDirty.add(k)
  }
}

export function listFavoriteFolders(): FavoriteFolder[] {
  const rows = getDb()
    .prepare('SELECT * FROM favorite_folders ORDER BY position, added_at')
    .all() as FavoriteRow[]
  return rows.map((r) => ({
    serverId: r.server_id,
    path: r.path,
    libraryRootId: r.library_root_id,
    addedAt: r.added_at
  }))
}

export function addFavoriteFolder(input: FavoriteFolder): FavoriteFolder[] {
  const db = getDb()
  const exists = db
    .prepare('SELECT 1 FROM favorite_folders WHERE server_id = ? AND path = ?')
    .get(input.serverId, input.path)
  if (!exists) {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM favorite_folders').get() as {
      count: number
    }
    db.prepare(
      `INSERT INTO favorite_folders (server_id, path, library_root_id, added_at, position)
       VALUES (?, ?, ?, ?, ?)`
    ).run(input.serverId, input.path, input.libraryRootId, input.addedAt, count)
  }
  return listFavoriteFolders()
}

export function removeFavoriteFolder(serverId: string, pathValue: string): FavoriteFolder[] {
  getDb()
    .prepare('DELETE FROM favorite_folders WHERE server_id = ? AND path = ?')
    .run(serverId, pathValue)
  return listFavoriteFolders()
}
