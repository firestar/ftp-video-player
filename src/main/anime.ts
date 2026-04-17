import { Worker } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { app } from 'electron'
import type { AnimeMetadata } from '@shared/types'
import { cacheMetadata, getCachedMetadata } from './store.js'
import type {
  MetadataJob,
  MetadataJobMessage,
  MetadataJobResult
} from './metadataWorker.js'

function folderKey(serverId: string, folderPath: string): string {
  return createHash('sha1').update(`${serverId}:${folderPath}`).digest('hex')
}

/** Strip common release-group cruft so the folder name searches cleanly. */
export function normalizeFolderName(name: string): string {
  return name
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(1080p|720p|480p|2160p|4k|bluray|bdrip|web-?dl|hevc|x264|x265|dual audio|multi audio)\b/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// All Jikan fetches + poster downloads run on a dedicated worker thread so they
// never block the Electron main thread. The queue below also guarantees that
// only one metadata job is in-flight at a time — protecting Jikan's rate limit
// and keeping the worker's workload predictable.
let worker: Worker | undefined
let nextId = 1
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (err: Error) => void }
>()
let queue: Promise<unknown> = Promise.resolve()

function getWorker(): Worker {
  if (worker) return worker
  const posterDir = path.join(app.getPath('userData'), 'posters')
  const workerPath = path.join(__dirname, 'metadataWorker.js')
  const w = new Worker(workerPath, { workerData: { posterDir } })
  w.on('message', (msg: MetadataJobResult) => {
    const waiter = pending.get(msg.id)
    if (!waiter) return
    pending.delete(msg.id)
    if (msg.ok) waiter.resolve(msg.result)
    else waiter.reject(new Error(msg.error ?? 'metadata worker failed'))
  })
  w.on('error', (err) => {
    console.error('[anime] metadata worker error', err)
    for (const [id, waiter] of pending) {
      pending.delete(id)
      waiter.reject(err)
    }
  })
  w.on('exit', (code) => {
    if (code !== 0) console.error('[anime] metadata worker exited with code', code)
    worker = undefined
  })
  worker = w
  return w
}

function dispatch<T>(job: MetadataJob): Promise<T> {
  const task = queue.then(
    () =>
      new Promise<T>((resolve, reject) => {
        const id = nextId++
        pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject
        })
        const message: MetadataJobMessage = { id, job }
        try {
          getWorker().postMessage(message)
        } catch (err) {
          pending.delete(id)
          reject(err as Error)
        }
      })
  )
  queue = task.then(
    () => undefined,
    () => undefined
  )
  return task
}

export async function searchAnime(query: string): Promise<AnimeMetadata[]> {
  return dispatch<AnimeMetadata[]>({ kind: 'search', query })
}

export async function resolveMetadataForFolder(
  serverId: string,
  folderPath: string,
  folderName: string,
  options: { force?: boolean } = {}
): Promise<AnimeMetadata | undefined> {
  const key = folderKey(serverId, folderPath)
  if (!options.force) {
    const cached = getCachedMetadata(key)
    if (cached) return cached
  }
  const query = normalizeFolderName(folderName)
  if (!query) return undefined
  let best: AnimeMetadata | undefined
  try {
    best = await dispatch<AnimeMetadata | undefined>({ kind: 'resolve', query, key })
  } catch {
    return undefined
  }
  if (!best) return undefined
  cacheMetadata(key, best)
  return best
}

export async function overrideMetadataForFolder(
  serverId: string,
  folderPath: string,
  metadata: AnimeMetadata
): Promise<AnimeMetadata> {
  const key = folderKey(serverId, folderPath)
  if (metadata.imageUrl && !metadata.posterPath) {
    metadata.posterPath = await dispatch<string | undefined>({
      kind: 'downloadPoster',
      imageUrl: metadata.imageUrl,
      key
    })
  }
  cacheMetadata(key, metadata)
  return metadata
}
