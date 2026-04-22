import { ipcMain } from 'electron'
import type {
  AnimeMetadata,
  ConnectionTestResult,
  FavoriteFolder,
  FtpServerConfig,
  LibraryRoot,
  RemoteEntry,
  SyncConfig,
  VideoProgress
} from '@shared/types'
import {
  addFavoriteFolder,
  addLibraryRoot,
  getServer,
  getVideoProgress,
  listFavoriteFolders,
  listLibraryRoots,
  listServers,
  listVideoProgress,
  removeFavoriteFolder,
  removeLibraryRoot,
  removeServer,
  setVideoProgress,
  upsertServer
} from './store.js'
import { createFtpClient } from './ftp/client.js'
import {
  getCachedAnimeEntry,
  getCachedLibrary,
  loadAnimeEntry,
  scanAllLibrariesStreaming
} from './library.js'
import { overrideMetadataForFolder, resolveMetadataForFolder, searchAnime } from './anime.js'
import { scanMetadataMismatches } from './metadataMatch.js'
import { generateThumbnail } from './thumbnail.js'
import { registerStream, unregisterStream } from './stream-server.js'
import {
  clearSyncConfig,
  getSyncConfig,
  pullSync,
  pushSync,
  setSyncConfig,
  testSync
} from './sync.js'

export function registerIpcHandlers(): void {
  ipcMain.handle('servers:list', () => listServers())

  ipcMain.handle('servers:upsert', (_e, input: Omit<FtpServerConfig, 'id'> & { id?: string }) =>
    upsertServer(input)
  )

  ipcMain.handle('servers:remove', (_e, id: string) => removeServer(id))

  ipcMain.handle(
    'servers:test',
    async (_e, config: FtpServerConfig): Promise<ConnectionTestResult> => {
      const client = await createFtpClient(config)
      try {
        await client.connect()
        await client.list('/').catch(() => [])
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      } finally {
        await client.disconnect().catch(() => undefined)
      }
    }
  )

  ipcMain.handle(
    'servers:browse',
    async (_e, serverId: string, remotePath: string): Promise<RemoteEntry[]> => {
      const server = getServer(serverId)
      if (!server) throw new Error('server not found')
      const client = await createFtpClient(server)
      try {
        await client.connect()
        return await client.list(remotePath || '/')
      } finally {
        await client.disconnect().catch(() => undefined)
      }
    }
  )

  ipcMain.handle('libraryRoots:list', () => listLibraryRoots())

  ipcMain.handle('libraryRoots:add', (_e, input: Omit<LibraryRoot, 'id'>) => addLibraryRoot(input))

  ipcMain.handle('libraryRoots:remove', (_e, id: string) => removeLibraryRoot(id))

  ipcMain.handle('library:cached', () => getCachedLibrary())

  ipcMain.handle('library:scan', async (event) => {
    const sender = event.sender
    try {
      await scanAllLibrariesStreaming((entry) => {
        if (!sender.isDestroyed()) sender.send('library:item', entry)
      })
    } finally {
      if (!sender.isDestroyed()) sender.send('library:done')
    }
  })

  ipcMain.handle(
    'library:loadAnime',
    async (_e, serverId: string, folderPath: string, libraryRootId: string) =>
      loadAnimeEntry(serverId, folderPath, libraryRootId)
  )

  ipcMain.handle(
    'library:cachedAnime',
    (_e, serverId: string, folderPath: string, libraryRootId: string) =>
      getCachedAnimeEntry(serverId, folderPath, libraryRootId)
  )

  ipcMain.handle('anime:search', async (_e, query: string) => searchAnime(query))

  ipcMain.handle(
    'anime:overrideMetadata',
    async (_e, serverId: string, folderPath: string, metadata: AnimeMetadata) =>
      overrideMetadataForFolder(serverId, folderPath, metadata)
  )

  ipcMain.handle(
    'anime:refreshMetadata',
    async (_e, serverId: string, folderPath: string, folderName: string) =>
      resolveMetadataForFolder(serverId, folderPath, folderName, { force: true })
  )

  ipcMain.handle('library:scanMetadataMismatches', () => scanMetadataMismatches())

  ipcMain.handle(
    'thumbnail:generate',
    async (_e, serverId: string, remotePath: string, timestampSeconds?: number) => {
      const server = getServer(serverId)
      if (!server) throw new Error('server not found')
      return generateThumbnail(server, remotePath, { timestampSeconds })
    }
  )

  ipcMain.handle(
    'stream:register',
    (_e, serverId: string, remotePath: string, size: number) =>
      registerStream({ serverId, path: remotePath, size })
  )

  ipcMain.handle('stream:unregister', (_e, token: string) => unregisterStream(token))

  ipcMain.handle('progress:get', (_e, serverId: string, remotePath: string) =>
    getVideoProgress(serverId, remotePath)
  )

  // Fire-and-forget channel because the renderer calls this ~100x/sec.
  ipcMain.on('progress:set', (_e, progress: VideoProgress) => {
    if (progress && typeof progress.positionSeconds === 'number') {
      setVideoProgress(progress)
    }
  })

  ipcMain.handle('progress:list', () => listVideoProgress())

  ipcMain.handle('favorites:list', () => listFavoriteFolders())

  ipcMain.handle('favorites:add', (_e, input: FavoriteFolder) => addFavoriteFolder(input))

  ipcMain.handle('favorites:remove', (_e, serverId: string, path: string) =>
    removeFavoriteFolder(serverId, path)
  )

  ipcMain.handle('sync:get', () => getSyncConfig())
  ipcMain.handle('sync:set', (_e, config: SyncConfig) => setSyncConfig(config))
  ipcMain.handle('sync:clear', () => clearSyncConfig())
  ipcMain.handle('sync:test', (_e, config: SyncConfig) => testSync(config))
  ipcMain.handle('sync:push', () => pushSync())
  ipcMain.handle('sync:pull', () => pullSync())

  ipcMain.handle('progress:listUnfinished', () => {
    return listVideoProgress()
      .filter((p) => {
        if (!p.durationSeconds || p.durationSeconds <= 0) return p.positionSeconds > 5
        const ratio = p.positionSeconds / p.durationSeconds
        return ratio > 0.005 && ratio < 0.85
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  })
}
