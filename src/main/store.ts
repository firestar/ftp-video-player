import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import type { FtpServerConfig, LibraryRoot, AnimeMetadata } from '@shared/types'

interface Schema {
  servers: FtpServerConfig[]
  libraryRoots: LibraryRoot[]
  metadataByFolder: Record<string, AnimeMetadata>
}

const store = new Store<Schema>({
  name: 'ftp-anime-player',
  defaults: {
    servers: [],
    libraryRoots: [],
    metadataByFolder: {}
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
  store.set(
    'servers',
    store.get('servers').filter((s) => s.id !== id)
  )
  store.set(
    'libraryRoots',
    store.get('libraryRoots').filter((r) => r.serverId !== id)
  )
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
