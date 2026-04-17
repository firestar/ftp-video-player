import { createHash } from 'node:crypto'
import type { AnimeEntry, LibraryRoot, VideoFile } from '@shared/types'
import { isVideoFile } from '@shared/types'
import { createFtpClient } from './ftp/client.js'
import {
  getAllCachedEntries,
  getCachedEntriesForRoot,
  getCachedMetadata,
  getCachedVideos,
  getServer,
  listLibraryRoots,
  setCachedEntriesForRoot,
  setCachedVideos
} from './store.js'
import { resolveMetadataForFolder } from './anime.js'

function animeId(serverId: string, folderPath: string): string {
  return createHash('sha1').update(`${serverId}:${folderPath}`).digest('hex')
}

function folderKey(serverId: string, folderPath: string): string {
  return createHash('sha1').update(`${serverId}:${folderPath}`).digest('hex')
}

async function listFolderVideos(
  serverId: string,
  folderPath: string
): Promise<VideoFile[]> {
  const server = getServer(serverId)
  if (!server) return []
  const client = await createFtpClient(server)
  try {
    await client.connect()
    const entries = await client.list(folderPath)
    return entries
      .filter((e) => e.type === 'file' && isVideoFile(e.name))
      .map((e) => ({
        name: e.name,
        path: e.path,
        size: e.size,
        modifiedAt: e.modifiedAt
      }))
  } finally {
    await client.disconnect().catch(() => undefined)
  }
}

/** Enumerate one library root into a list of anime entries (folders + videos). */
export async function scanLibraryRoot(root: LibraryRoot): Promise<AnimeEntry[]> {
  const server = getServer(root.serverId)
  if (!server) return []
  const client = await createFtpClient(server)
  const entries: AnimeEntry[] = []
  try {
    await client.connect()
    const children = await client.list(root.path)
    for (const child of children) {
      if (child.type !== 'directory') continue
      entries.push({
        id: animeId(server.id, child.path),
        serverId: server.id,
        libraryRootId: root.id,
        folderName: child.name,
        path: child.path,
        videos: getCachedVideos(folderKey(server.id, child.path)) ?? [],
        lastScannedAt: Date.now()
      })
    }
  } finally {
    await client.disconnect().catch(() => undefined)
  }
  return entries
}

export async function scanAllLibraries(): Promise<AnimeEntry[]> {
  const roots = listLibraryRoots()
  const all: AnimeEntry[] = []
  for (const root of roots) {
    try {
      const entries = await scanLibraryRoot(root)
      all.push(...entries)
    } catch (err) {
      console.error('[library] scan failed for root', root, err)
    }
  }
  return all
}

/** Attach metadata (from cache or Jikan) to a batch of anime entries. */
export async function enrichWithMetadata(entries: AnimeEntry[]): Promise<AnimeEntry[]> {
  const out: AnimeEntry[] = []
  for (const entry of entries) {
    const metadata = await resolveMetadataForFolder(entry.serverId, entry.path, entry.folderName).catch(
      () => undefined
    )
    out.push({ ...entry, metadata })
  }
  return out
}

/** All entries already in the local cache, with their cached metadata attached. */
export function getCachedLibrary(): AnimeEntry[] {
  return getAllCachedEntries().map((entry) => {
    const metadata = entry.metadata ?? getCachedMetadata(folderKey(entry.serverId, entry.path))
    const videos = entry.videos.length > 0
      ? entry.videos
      : getCachedVideos(folderKey(entry.serverId, entry.path)) ?? []
    return { ...entry, metadata, videos }
  })
}

/**
 * Two-phase scan:
 *   1. List the folders in every library root and emit them immediately so the
 *      grid populates right away (with cached metadata + posters where we have
 *      them).
 *   2. Then go back and fetch metadata + posters from MyAnimeList for any
 *      folder that's missing it, re-emitting each entry once it's enriched.
 */
export async function scanAllLibrariesStreaming(
  onItem: (entry: AnimeEntry) => void
): Promise<void> {
  const roots = listLibraryRoots()
  const enrichedByRoot = new Map<string, AnimeEntry[]>()
  const needsMetadata: AnimeEntry[] = []

  for (const root of roots) {
    let scanned: AnimeEntry[]
    try {
      scanned = await scanLibraryRoot(root)
    } catch (err) {
      console.error('[library] scan failed for root', root, err)
      continue
    }

    const enriched: AnimeEntry[] = scanned.map((entry) => ({
      ...entry,
      metadata: getCachedMetadata(folderKey(entry.serverId, entry.path))
    }))
    enrichedByRoot.set(root.id, enriched)
    setCachedEntriesForRoot(root.id, enriched)

    for (const entry of enriched) {
      onItem(entry)
      if (!entry.metadata) needsMetadata.push(entry)
    }
  }

  for (const entry of needsMetadata) {
    const metadata = await resolveMetadataForFolder(
      entry.serverId,
      entry.path,
      entry.folderName
    ).catch(() => undefined)
    if (!metadata) continue
    const updated = { ...entry, metadata }
    const enriched = enrichedByRoot.get(entry.libraryRootId)
    if (enriched) {
      const idx = enriched.findIndex((e) => e.id === updated.id)
      if (idx >= 0) {
        enriched[idx] = updated
        setCachedEntriesForRoot(entry.libraryRootId, enriched)
      }
    }
    onItem(updated)
  }
}

/** Hydrate a single anime entry from local cache only. Returns undefined if
 *  we have no record of this folder. Used to render the detail view instantly
 *  before the live FTP listing comes back. */
export function getCachedAnimeEntry(
  serverId: string,
  folderPath: string,
  libraryRootId: string
): AnimeEntry | undefined {
  const cacheKey = folderKey(serverId, folderPath)
  const cachedVideos = getCachedVideos(cacheKey)
  const cachedMetadata = getCachedMetadata(cacheKey)
  if (!cachedVideos && !cachedMetadata) return undefined
  const folderName = folderPath.split('/').filter(Boolean).pop() ?? folderPath
  return {
    id: animeId(serverId, folderPath),
    serverId,
    libraryRootId,
    folderName,
    path: folderPath,
    videos: cachedVideos ?? [],
    metadata: cachedMetadata,
    lastScannedAt: undefined
  }
}

export async function loadAnimeEntry(
  serverId: string,
  folderPath: string,
  libraryRootId: string
): Promise<AnimeEntry | undefined> {
  const server = getServer(serverId)
  if (!server) return undefined
  const folderName = folderPath.split('/').filter(Boolean).pop() ?? folderPath
  const cacheKey = folderKey(serverId, folderPath)
  const cachedVideos = getCachedVideos(cacheKey)
  let videos: VideoFile[]
  try {
    videos = await listFolderVideos(serverId, folderPath)
    setCachedVideos(cacheKey, videos)
  } catch (err) {
    if (cachedVideos) {
      console.warn('[library] using cached videos after live listing failed', err)
      videos = cachedVideos
    } else {
      throw err
    }
  }
  const metadata = await resolveMetadataForFolder(serverId, folderPath, folderName).catch(
    () => getCachedMetadata(cacheKey)
  )
  return {
    id: animeId(serverId, folderPath),
    serverId,
    libraryRootId,
    folderName,
    path: folderPath,
    videos,
    metadata,
    lastScannedAt: Date.now()
  }
}
