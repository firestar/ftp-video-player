import { contextBridge, ipcRenderer } from 'electron'
import type { AnimeEntry, Api } from '@shared/types'

const api: Api = {
  listServers: () => ipcRenderer.invoke('servers:list'),
  upsertServer: (input) => ipcRenderer.invoke('servers:upsert', input),
  removeServer: (id) => ipcRenderer.invoke('servers:remove', id),
  testServer: (config) => ipcRenderer.invoke('servers:test', config),
  browse: (serverId, path) => ipcRenderer.invoke('servers:browse', serverId, path),

  listLibraryRoots: () => ipcRenderer.invoke('libraryRoots:list'),
  addLibraryRoot: (input) => ipcRenderer.invoke('libraryRoots:add', input),
  removeLibraryRoot: (id) => ipcRenderer.invoke('libraryRoots:remove', id),

  scanLibrary: () => ipcRenderer.invoke('library:scan'),
  cachedLibrary: () => ipcRenderer.invoke('library:cached'),
  onLibraryItem: (cb: (entry: AnimeEntry) => void) => {
    const handler = (_e: unknown, entry: AnimeEntry): void => cb(entry)
    ipcRenderer.on('library:item', handler)
    return () => ipcRenderer.removeListener('library:item', handler)
  },
  onLibraryDone: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('library:done', handler)
    return () => ipcRenderer.removeListener('library:done', handler)
  },
  loadAnime: (serverId, path, libraryRootId) =>
    ipcRenderer.invoke('library:loadAnime', serverId, path, libraryRootId),
  cachedAnime: (serverId, path, libraryRootId) =>
    ipcRenderer.invoke('library:cachedAnime', serverId, path, libraryRootId),

  searchAnime: (query) => ipcRenderer.invoke('anime:search', query),
  overrideMetadata: (serverId, path, metadata) =>
    ipcRenderer.invoke('anime:overrideMetadata', serverId, path, metadata),
  refreshMetadata: (serverId, path, folderName) =>
    ipcRenderer.invoke('anime:refreshMetadata', serverId, path, folderName),

  generateThumbnail: (serverId, remotePath, timestampSeconds) =>
    ipcRenderer.invoke('thumbnail:generate', serverId, remotePath, timestampSeconds),

  registerStream: (serverId, remotePath, size) =>
    ipcRenderer.invoke('stream:register', serverId, remotePath, size),
  unregisterStream: (token) => ipcRenderer.invoke('stream:unregister', token)
}

contextBridge.exposeInMainWorld('api', api)
