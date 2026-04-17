import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import type {
  AnimeEntry,
  AnimeMetadata,
  FavoriteFolder,
  FtpServerConfig,
  LibraryRoot,
  VideoFile,
  VideoProgress
} from '@shared/types'

interface Schema {
  servers: FtpServerConfig[]
  libraryRoots: LibraryRoot[]
  metadataByFolder: Record<string, AnimeMetadata>
  entriesByRoot: Record<string, AnimeEntry[]>
  videosByFolder: Record<string, VideoFile[]>
  progressByVideo: Record<string, VideoProgress>
  favoriteFolders: FavoriteFolder[]
}

const store = new Store<Schema>({
  name: 'ftp-anime-player',
  defaults: {
    servers: [],
    libraryRoots: [],
    metadataByFolder: {},
    entriesByRoot: {},
    videosByFolder: {},
    progressByVideo: {},
    favoriteFolders: []
  }
})

export function listServers(): FtpServerConfig[] {
  return store.get('servers')
}

export function getServer(id: string): FtpServerConfig | undefined {
  return store.get('servers').find((s) => s.id === id)
}

export function upsertServer(input: Omit<FtpServerConfig, 'id'> & { id?: string }): FtpServerConfig {
  const servers = store.get('servers')
  if (input.id) {
    const idx = servers.findIndex((s) => s.id === input.id)
    if (idx >= 0) {
      const updated = { ...servers[idx], ...input } as FtpServerConfig
      servers[idx] = updated
      store.set('servers', servers)
      return updated
    }
  }
  const created: FtpServerConfig = { ...input, id: input.id ?? randomUUID() } as FtpServerConfig
  store.set('servers', [...servers, created])
  return created
}

export function removeServer(id: string): void {
  const removedRoots = store.get('libraryRoots').filter((r) => r.serverId === id)
  store.set(
    'servers',
    store.get('servers').filter((s) => s.id !== id)
  )
  store.set(
    'libraryRoots',
    store.get('libraryRoots').filter((r) => r.serverId !== id)
  )
  if (removedRoots.length > 0) {
    const byRoot = store.get('entriesByRoot')
    for (const r of removedRoots) delete byRoot[r.id]
    store.set('entriesByRoot', byRoot)
  }
}

export function listLibraryRoots(): LibraryRoot[] {
  return store.get('libraryRoots')
}

export function addLibraryRoot(input: Omit<LibraryRoot, 'id'>): LibraryRoot {
  const created: LibraryRoot = { ...input, id: randomUUID() }
  store.set('libraryRoots', [...store.get('libraryRoots'), created])
  return created
}

export function removeLibraryRoot(id: string): void {
  store.set(
    'libraryRoots',
    store.get('libraryRoots').filter((r) => r.id !== id)
  )
  const byRoot = store.get('entriesByRoot')
  if (id in byRoot) {
    delete byRoot[id]
    store.set('entriesByRoot', byRoot)
  }
}

export function cacheMetadata(folderKey: string, metadata: AnimeMetadata): void {
  const all = store.get('metadataByFolder')
  all[folderKey] = metadata
  store.set('metadataByFolder', all)
}

export function getCachedMetadata(folderKey: string): AnimeMetadata | undefined {
  return store.get('metadataByFolder')[folderKey]
}

export function clearCachedMetadata(folderKey: string): void {
  const all = store.get('metadataByFolder')
  delete all[folderKey]
  store.set('metadataByFolder', all)
}

export function getCachedEntriesForRoot(rootId: string): AnimeEntry[] {
  return store.get('entriesByRoot')[rootId] ?? []
}

export function getAllCachedEntries(): AnimeEntry[] {
  const byRoot = store.get('entriesByRoot')
  const validRootIds = new Set(store.get('libraryRoots').map((r) => r.id))
  const out: AnimeEntry[] = []
  for (const [rootId, entries] of Object.entries(byRoot)) {
    if (!validRootIds.has(rootId)) continue
    out.push(...entries)
  }
  return out
}

export function setCachedEntriesForRoot(rootId: string, entries: AnimeEntry[]): void {
  const all = store.get('entriesByRoot')
  all[rootId] = entries
  store.set('entriesByRoot', all)
}

export function getCachedVideos(folderKey: string): VideoFile[] | undefined {
  return store.get('videosByFolder')[folderKey]
}

export function setCachedVideos(folderKey: string, videos: VideoFile[]): void {
  const all = store.get('videosByFolder')
  all[folderKey] = videos
  store.set('videosByFolder', all)
}

// Progress is written ~100x/sec while a video plays, so we keep the full map
// in memory and flush to disk on a debounce to avoid thrashing.
const progressCache: Record<string, VideoProgress> = store.get('progressByVideo')
let progressDirty = false

function progressKey(serverId: string, remotePath: string): string {
  return `${serverId}::${remotePath}`
}

export function getVideoProgress(serverId: string, remotePath: string): VideoProgress | undefined {
  return progressCache[progressKey(serverId, remotePath)]
}

export function setVideoProgress(progress: VideoProgress): void {
  progressCache[progressKey(progress.serverId, progress.path)] = progress
  progressDirty = true
}

export function listVideoProgress(): VideoProgress[] {
  return Object.values(progressCache)
}

export function flushVideoProgress(): void {
  if (!progressDirty) return
  store.set('progressByVideo', progressCache)
  progressDirty = false
}

export function listFavoriteFolders(): FavoriteFolder[] {
  return store.get('favoriteFolders')
}

export function addFavoriteFolder(input: FavoriteFolder): FavoriteFolder[] {
  const existing = store.get('favoriteFolders')
  if (existing.some((f) => f.serverId === input.serverId && f.path === input.path)) {
    return existing
  }
  const next = [...existing, input]
  store.set('favoriteFolders', next)
  return next
}

export function removeFavoriteFolder(serverId: string, path: string): FavoriteFolder[] {
  const next = store
    .get('favoriteFolders')
    .filter((f) => !(f.serverId === serverId && f.path === path))
  store.set('favoriteFolders', next)
  return next
}
