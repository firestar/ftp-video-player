import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '@shared/types'

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
  loadAnime: (serverId, path, libraryRootId) =>
    ipcRenderer.invoke('library:loadAnime', serverId, path, libraryRootId),

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
