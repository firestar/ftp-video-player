import path from 'node:path'
import { promises as fs, createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { app } from 'electron'
import type { SyncConfig, SyncResult, SyncStatus } from '@shared/types'
import {
  clearSyncConfig as clearStoredSyncConfig,
  flushVideoProgress,
  getDbFilePath,
  getSyncConfig as getStoredSyncConfig,
  setSyncConfig as writeSyncConfig
} from './store.js'

/** Assemble a canonical base URL (no trailing slash) + api path. */
function apiUrl(baseUrl: string, suffix: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const tail = suffix.startsWith('/') ? suffix : `/${suffix}`
  return `${base}${tail}`
}

function authHeader(config: Pick<SyncConfig, 'username' | 'password'>): string {
  const token = Buffer.from(`${config.username}:${config.password}`).toString('base64')
  return `Basic ${token}`
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text || `${res.status} ${res.statusText}`
  } catch {
    return `${res.status} ${res.statusText}`
  }
}

export function getSyncConfig(): SyncConfig | undefined {
  return getStoredSyncConfig()
}

export function setSyncConfig(config: SyncConfig): SyncConfig {
  const trimmed: SyncConfig = {
    baseUrl: config.baseUrl.trim(),
    username: config.username.trim(),
    password: config.password,
    lastPushedAt: config.lastPushedAt,
    lastPulledAt: config.lastPulledAt
  }
  if (!trimmed.baseUrl) throw new Error('Sync server URL is required')
  if (!trimmed.username) throw new Error('Sync username is required')
  if (!trimmed.password) throw new Error('Sync password is required')
  return writeSyncConfig(trimmed)
}

export function clearSyncConfig(): void {
  clearStoredSyncConfig()
}

export async function testSync(config: SyncConfig): Promise<SyncStatus> {
  try {
    const authRes = await fetch(apiUrl(config.baseUrl, '/api/auth/me'), {
      headers: { Authorization: authHeader(config) }
    })
    if (authRes.status === 401) return { ok: false, message: 'Invalid username or password' }
    if (!authRes.ok) return { ok: false, message: await readErrorBody(authRes) }

    const [metaRes, postersRes, thumbsRes] = await Promise.all([
      fetch(apiUrl(config.baseUrl, '/api/sync/db/meta'), {
        headers: { Authorization: authHeader(config) }
      }),
      fetch(apiUrl(config.baseUrl, '/api/sync/cache/posters'), {
        headers: { Authorization: authHeader(config) }
      }),
      fetch(apiUrl(config.baseUrl, '/api/sync/cache/thumbnails'), {
        headers: { Authorization: authHeader(config) }
      })
    ])

    const meta = metaRes.ok ? ((await metaRes.json()) as Record<string, unknown>) : {}
    const posters = postersRes.ok ? ((await postersRes.json()) as { count?: number }) : {}
    const thumbs = thumbsRes.ok ? ((await thumbsRes.json()) as { count?: number }) : {}

    return {
      ok: true,
      message: 'Connected',
      remoteDbExists: Boolean(meta.exists),
      remoteDbSize: typeof meta.size === 'number' ? (meta.size as number) : undefined,
      remoteDbLastModifiedMs:
        typeof meta.lastModifiedMs === 'number' ? (meta.lastModifiedMs as number) : undefined,
      remotePosterCount: posters.count,
      remoteThumbnailCount: thumbs.count
    }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

function requireConfig(): SyncConfig {
  const config = getStoredSyncConfig()
  if (!config) {
    throw new Error('Sync is not configured. Fill in the server URL and credentials first.')
  }
  return config
}

async function uploadFile(config: SyncConfig, apiPath: string, file: string): Promise<number> {
  const info = await fs.stat(file)
  const stream = createReadStream(file)
  const res = await fetch(apiUrl(config.baseUrl, apiPath), {
    method: 'PUT',
    headers: {
      Authorization: authHeader(config),
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(info.size)
    },
    // Node's fetch accepts a Readable here; the cast keeps TS happy for dom types.
    body: Readable.toWeb(stream) as unknown as ReadableStream,
    duplex: 'half'
  } as RequestInit & { duplex: 'half' })
  if (!res.ok) throw new Error(`upload ${apiPath} failed: ${await readErrorBody(res)}`)
  return info.size
}

async function downloadFile(config: SyncConfig, apiPath: string, target: string): Promise<number> {
  const res = await fetch(apiUrl(config.baseUrl, apiPath), {
    headers: { Authorization: authHeader(config) }
  })
  if (res.status === 404) return 0
  if (!res.ok) throw new Error(`download ${apiPath} failed: ${await readErrorBody(res)}`)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.part`
  if (!res.body) throw new Error(`download ${apiPath} returned no body`)
  await pipeline(Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream), createWriteStream(tmp))
  await fs.rename(tmp, target)
  const info = await fs.stat(target)
  return info.size
}

async function listRemoteCache(
  config: SyncConfig,
  kind: 'posters' | 'thumbnails'
): Promise<Array<{ name: string; size: number; lastModifiedMs: number }>> {
  const res = await fetch(apiUrl(config.baseUrl, `/api/sync/cache/${kind}`), {
    headers: { Authorization: authHeader(config) }
  })
  if (!res.ok) throw new Error(`list ${kind} failed: ${await readErrorBody(res)}`)
  const body = (await res.json()) as { files?: Array<{ name: string; size: number; lastModifiedMs: number }> }
  return body.files ?? []
}

async function listLocalCache(
  kind: 'posters' | 'thumbnails'
): Promise<Array<{ name: string; size: number; path: string }>> {
  const dir = path.join(app.getPath('userData'), kind)
  try {
    const names = await fs.readdir(dir)
    const out: Array<{ name: string; size: number; path: string }> = []
    for (const name of names) {
      if (name.startsWith('.')) continue
      const full = path.join(dir, name)
      try {
        const info = await fs.stat(full)
        if (info.isFile()) out.push({ name, size: info.size, path: full })
      } catch {
        // skip files we can't stat
      }
    }
    return out
  } catch {
    return []
  }
}

export async function pushSync(): Promise<SyncResult> {
  const config = requireConfig()
  const errors: string[] = []
  flushVideoProgress()
  const dbPath = getDbFilePath()
  let dbBytes = 0
  try {
    dbBytes = await uploadFile(config, '/api/sync/db', dbPath)
  } catch (err) {
    errors.push((err as Error).message)
  }

  let postersUploaded = 0
  let thumbnailsUploaded = 0

  for (const kind of ['posters', 'thumbnails'] as const) {
    const [local, remote] = await Promise.all([
      listLocalCache(kind),
      listRemoteCache(config, kind).catch((err) => {
        errors.push(`list remote ${kind}: ${(err as Error).message}`)
        return [] as Array<{ name: string; size: number; lastModifiedMs: number }>
      })
    ])
    const remoteByName = new Map(remote.map((r) => [r.name, r]))
    for (const file of local) {
      const existing = remoteByName.get(file.name)
      // Poster/thumbnail files are content-addressable (sha1 hash based), so
      // skipping any entry with a matching size is safe and saves bandwidth.
      if (existing && existing.size === file.size) continue
      try {
        await uploadFile(config, `/api/sync/cache/${kind}/${encodeURIComponent(file.name)}`, file.path)
        if (kind === 'posters') postersUploaded++
        else thumbnailsUploaded++
      } catch (err) {
        errors.push(`upload ${kind}/${file.name}: ${(err as Error).message}`)
      }
    }
  }

  const now = Date.now()
  writeSyncConfig({ ...config, lastPushedAt: now })

  return {
    ok: errors.length === 0,
    message:
      errors.length === 0
        ? `Pushed db + ${postersUploaded} posters + ${thumbnailsUploaded} thumbnails`
        : `Push completed with ${errors.length} error(s)`,
    dbBytes,
    postersUploaded,
    thumbnailsUploaded,
    errors: errors.length ? errors : undefined
  }
}

export async function pullSync(): Promise<SyncResult> {
  const config = requireConfig()
  const errors: string[] = []
  const dbPath = getDbFilePath()
  let dbBytes = 0
  try {
    dbBytes = await downloadFile(config, '/api/sync/db', dbPath)
  } catch (err) {
    errors.push((err as Error).message)
  }

  let postersDownloaded = 0
  let thumbnailsDownloaded = 0

  for (const kind of ['posters', 'thumbnails'] as const) {
    const [remote, local] = await Promise.all([
      listRemoteCache(config, kind).catch((err) => {
        errors.push(`list remote ${kind}: ${(err as Error).message}`)
        return [] as Array<{ name: string; size: number; lastModifiedMs: number }>
      }),
      listLocalCache(kind)
    ])
    const localByName = new Map(local.map((r) => [r.name, r]))
    const targetDir = path.join(app.getPath('userData'), kind)
    for (const file of remote) {
      const existing = localByName.get(file.name)
      if (existing && existing.size === file.size) continue
      const target = path.join(targetDir, file.name)
      try {
        await downloadFile(config, `/api/sync/cache/${kind}/${encodeURIComponent(file.name)}`, target)
        if (kind === 'posters') postersDownloaded++
        else thumbnailsDownloaded++
      } catch (err) {
        errors.push(`download ${kind}/${file.name}: ${(err as Error).message}`)
      }
    }
  }

  const now = Date.now()
  writeSyncConfig({ ...config, lastPulledAt: now })

  return {
    ok: errors.length === 0,
    message:
      errors.length === 0
        ? `Pulled db + ${postersDownloaded} posters + ${thumbnailsDownloaded} thumbnails`
        : `Pull completed with ${errors.length} error(s)`,
    dbBytes,
    postersDownloaded,
    thumbnailsDownloaded,
    errors: errors.length ? errors : undefined
  }
}
