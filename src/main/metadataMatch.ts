import type { AnimeEntry, AnimeMetadata, MetadataMatch, MetadataMismatch } from '@shared/types'
import { normalizeFolderName } from './anime.js'
import { getAllCachedEntries } from './store.js'

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'to',
  'in',
  'on',
  'no',
  'wa',
  'ga',
  'ni',
  'wo'
])

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
}

function candidateTitles(metadata: AnimeMetadata): string[] {
  return [metadata.title, metadata.englishTitle, metadata.japaneseTitle].filter(
    (t): t is string => typeof t === 'string' && t.trim().length > 0
  )
}

/**
 * Score how well a folder name matches the metadata title(s) on a 0..1 scale.
 *  - Exact substring containment (either direction) scores 1.
 *  - Otherwise returns the best token-overlap ratio across title variants:
 *    |folderTokens ∩ titleTokens| / |folderTokens|.
 *
 * Anything below `threshold` is considered a mismatch.
 */
export function scoreTitleMatch(
  folderName: string,
  metadata: AnimeMetadata | undefined,
  threshold = 0.5
): MetadataMatch {
  if (!metadata) {
    return { ok: false, score: 0, reason: 'missing', bestTitle: undefined }
  }
  const titles = candidateTitles(metadata)
  if (titles.length === 0) {
    return { ok: false, score: 0, reason: 'missing', bestTitle: undefined }
  }

  const folderClean = normalizeFolderName(folderName).toLowerCase().trim()
  if (!folderClean) {
    // Nothing usable to compare against; don't flag these.
    return { ok: true, score: 1, bestTitle: titles[0] }
  }

  for (const title of titles) {
    const t = title.toLowerCase().trim()
    if (!t) continue
    if (folderClean.includes(t) || t.includes(folderClean)) {
      return { ok: true, score: 1, bestTitle: title }
    }
  }

  const folderTokens = tokenize(folderClean)
  if (folderTokens.length === 0) {
    return { ok: true, score: 1, bestTitle: titles[0] }
  }

  let bestScore = 0
  let bestTitle = titles[0]
  for (const title of titles) {
    const titleTokens = new Set(tokenize(title))
    if (titleTokens.size === 0) continue
    const matched = folderTokens.filter((tok) => titleTokens.has(tok)).length
    const score = matched / folderTokens.length
    if (score > bestScore) {
      bestScore = score
      bestTitle = title
    }
  }

  const rounded = Math.round(bestScore * 100) / 100
  if (bestScore >= threshold) {
    return { ok: true, score: rounded, bestTitle }
  }
  return {
    ok: false,
    score: rounded,
    bestTitle,
    reason: bestScore === 0 ? 'no-overlap' : 'low-overlap'
  }
}

/** Walk every cached library entry and return the ones whose metadata title
 *  does not plausibly match the folder name. Entries without metadata are
 *  skipped — they are handled by the normal scan path, not by this scanner. */
export function scanMetadataMismatches(threshold = 0.5): MetadataMismatch[] {
  const entries = getAllCachedEntries()
  const out: MetadataMismatch[] = []
  for (const entry of entries) {
    if (!entry.metadata) continue
    const match = scoreTitleMatch(entry.folderName, entry.metadata, threshold)
    if (match.ok) continue
    out.push(toMismatch(entry, match))
  }
  out.sort((a, b) => a.score - b.score || a.folderName.localeCompare(b.folderName))
  return out
}

function toMismatch(entry: AnimeEntry, match: MetadataMatch): MetadataMismatch {
  return {
    entryId: entry.id,
    serverId: entry.serverId,
    libraryRootId: entry.libraryRootId,
    folderName: entry.folderName,
    path: entry.path,
    metadataTitle: entry.metadata?.title ?? '',
    metadataEnglishTitle: entry.metadata?.englishTitle,
    metadataJapaneseTitle: entry.metadata?.japaneseTitle,
    posterPath: entry.metadata?.posterPath,
    score: match.score,
    reason: match.reason ?? 'low-overlap'
  }
}
