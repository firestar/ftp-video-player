import { parentPort, workerData } from 'node:worker_threads'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AnimeMetadata } from '@shared/types'

interface WorkerInit {
  posterDir: string
}

const { posterDir } = workerData as WorkerInit

const JIKAN_BASE = 'https://api.jikan.moe/v4'

// Jikan limits to ~3 req/s; be conservative at ~1.2 req/s. Rate-limit state lives
// here in the worker so it's naturally shared across every metadata request.
let lastRequest = 0
async function rateLimit(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastRequest
  if (elapsed < 800) {
    await new Promise((resolve) => setTimeout(resolve, 800 - elapsed))
  }
  lastRequest = Date.now()
}

interface JikanSearchResponse {
  data: Array<{
    mal_id: number
    title: string
    title_english?: string
    title_japanese?: string
    synopsis?: string
    score?: number
    year?: number
    episodes?: number
    type?: string
    genres?: Array<{ name: string }>
    themes?: Array<{ name: string }>
    demographics?: Array<{ name: string }>
    explicit_genres?: Array<{ name: string }>
    images?: {
      jpg?: { image_url?: string; large_image_url?: string }
      webp?: { image_url?: string; large_image_url?: string }
    }
  }>
}

async function searchAnime(query: string): Promise<AnimeMetadata[]> {
  await rateLimit()
  const url = `${JIKAN_BASE}/anime?q=${encodeURIComponent(query)}&limit=10&sfw=false`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Jikan search failed: ${res.status}`)
  const json = (await res.json()) as JikanSearchResponse
  return json.data.map((d) => {
    const tags = [
      ...(d.themes?.map((t) => t.name) ?? []),
      ...(d.demographics?.map((t) => t.name) ?? []),
      ...(d.explicit_genres?.map((t) => t.name) ?? [])
    ]
    return {
      malId: d.mal_id,
      title: d.title,
      englishTitle: d.title_english,
      japaneseTitle: d.title_japanese,
      synopsis: d.synopsis,
      score: d.score,
      year: d.year,
      episodes: d.episodes,
      type: d.type,
      genres: d.genres?.map((g) => g.name),
      tags: tags.length > 0 ? tags : undefined,
      imageUrl: d.images?.jpg?.large_image_url ?? d.images?.jpg?.image_url
    }
  })
}

async function downloadPoster(imageUrl: string, key: string): Promise<string | undefined> {
  try {
    await fs.mkdir(posterDir, { recursive: true })
    const ext = path.extname(new URL(imageUrl).pathname).toLowerCase() || '.jpg'
    const filePath = path.join(posterDir, `${key}${ext}`)
    try {
      await fs.access(filePath)
      return filePath
    } catch {
      // fall through to download
    }
    const res = await fetch(imageUrl)
    if (!res.ok) return undefined
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.writeFile(filePath, buf)
    return filePath
  } catch {
    return undefined
  }
}

export type MetadataJob =
  | { kind: 'search'; query: string }
  | { kind: 'resolve'; query: string; key: string }
  | { kind: 'downloadPoster'; imageUrl: string; key: string }

export interface MetadataJobMessage {
  id: number
  job: MetadataJob
}

export interface MetadataJobResult {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

if (!parentPort) {
  throw new Error('metadataWorker must run as a worker thread')
}

const port = parentPort

port.on('message', async (msg: MetadataJobMessage) => {
  try {
    let result: unknown
    switch (msg.job.kind) {
      case 'search':
        result = await searchAnime(msg.job.query)
        break
      case 'resolve': {
        const results = await searchAnime(msg.job.query)
        const best = results[0]
        if (best?.imageUrl) {
          best.posterPath = await downloadPoster(best.imageUrl, msg.job.key)
        }
        result = best
        break
      }
      case 'downloadPoster':
        result = await downloadPoster(msg.job.imageUrl, msg.job.key)
        break
    }
    const reply: MetadataJobResult = { id: msg.id, ok: true, result }
    port.postMessage(reply)
  } catch (err) {
    const reply: MetadataJobResult = {
      id: msg.id,
      ok: false,
      error: (err as Error).message
    }
    port.postMessage(reply)
  }
})
