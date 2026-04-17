import { ipcMain } from 'electron'
import type {
  AnimeMetadata,
  ConnectionTestResult,
  FtpServerConfig,
  LibraryRoot,
  RemoteEntry
} from '@shared/types'
import {
  addLibraryRoot,
  getServer,
  listLibraryRoots,
  listServers,
  removeLibraryRoot,
  removeServer,
  upsertServer
} from './store.js'
import { createFtpClient } from './ftp/client.js'
import { enrichWithMetadata, loadAnimeEntry, scanAllLibraries } from './library.js'
import { overrideMetadataForFolder, resolveMetadataForFolder, searchAnime } from './anime.js'
import { generateThumbnail } from './thumbnail.js'
import { registerStream, unregisterStream } from './stream-server.js'

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

  ipcMain.handle('library:scan', async () => {
    const entries = await scanAllLibraries()
    return enrichWithMetadata(entries)
  })

  ipcMain.handle(
    'library:loadAnime',
    async (_e, serverId: string, folderPath: string, libraryRootId: string) =>
      loadAnimeEntry(serverId, folderPath, libraryRootId)
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
}
