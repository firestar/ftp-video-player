import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { app } from 'electron'
import type { AnimeMetadata } from '@shared/types'
import { cacheMetadata, getCachedMetadata } from './store.js'

const JIKAN_BASE = 'https://api.jikan.moe/v4'

let lastRequest = 0
async function rateLimit(): Promise<void> {
  // Jikan limits to ~3 req/s; be conservative at 1.2 req/s.
  const now = Date.now()
  const elapsed = now - lastRequest
  if (elapsed < 800) {
    await new Promise((resolve) => setTimeout(resolve, 800 - elapsed))
  }
  lastRequest = Date.now()
}

function posterCacheDir(): string {
  return path.join(app.getPath('userData'), 'posters')
}

async function ensurePosterDir(): Promise<string> {
  const dir = posterCacheDir()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

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

export async function searchAnime(query: string): Promise<AnimeMetadata[]> {
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
    const dir = await ensurePosterDir()
    const ext = path.extname(new URL(imageUrl).pathname).toLowerCase() || '.jpg'
    const filePath = path.join(dir, `${key}${ext}`)
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
  let results: AnimeMetadata[]
  try {
    results = await searchAnime(query)
  } catch {
    return undefined
  }
  const best = results[0]
  if (!best) return undefined
  if (best.imageUrl) {
    best.posterPath = await downloadPoster(best.imageUrl, key)
  }
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
    metadata.posterPath = await downloadPoster(metadata.imageUrl, key)
  }
  cacheMetadata(key, metadata)
  return metadata
}
