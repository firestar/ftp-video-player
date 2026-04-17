import { createHash } from 'node:crypto'
import type { AnimeEntry, LibraryRoot, VideoFile } from '@shared/types'
import { isVideoFile } from '@shared/types'
import { createFtpClient } from './ftp/client.js'
import { getServer, listLibraryRoots } from './store.js'
import { resolveMetadataForFolder } from './anime.js'

function animeId(serverId: string, folderPath: string): string {
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
        videos: [],
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

export async function loadAnimeEntry(
  serverId: string,
  folderPath: string,
  libraryRootId: string
): Promise<AnimeEntry | undefined> {
  const server = getServer(serverId)
  if (!server) return undefined
  const folderName = folderPath.split('/').filter(Boolean).pop() ?? folderPath
  const videos = await listFolderVideos(serverId, folderPath)
  const metadata = await resolveMetadataForFolder(serverId, folderPath, folderName).catch(() => undefined)
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
