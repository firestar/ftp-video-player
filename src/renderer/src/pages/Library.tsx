import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AnimeEntry, LibraryRoot, VideoProgress } from '@shared/types'
import { api, localFileUrl } from '../api'
import { formatWatchedTime } from './Anime'

type SortKey = 'name' | 'rating' | 'year' | 'episodes' | 'watched' | 'added'
type SortDir = 'asc' | 'desc'

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'rating', label: 'Rating' },
  { key: 'year', label: 'Year' },
  { key: 'episodes', label: 'Episodes' },
  { key: 'watched', label: 'Recently watched' },
  { key: 'added', label: 'Recently added' }
]

const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  rating: 'desc',
  year: 'desc',
  episodes: 'desc',
  watched: 'desc',
  added: 'desc'
}

const SORT_STORAGE_KEY = 'library:sort'
const FILTER_STORAGE_KEY = 'library:filter'

function loadSortPref(): { sortKey: SortKey; sortDir: SortDir } {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { sortKey?: SortKey; sortDir?: SortDir }
      if (parsed.sortKey && parsed.sortDir) {
        return { sortKey: parsed.sortKey, sortDir: parsed.sortDir }
      }
    }
  } catch {
    // ignore
  }
  return { sortKey: 'name', sortDir: 'asc' }
}

function loadFilterPref(): { genres: string[]; tags: string[] } {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { genres?: string[]; tags?: string[] }
      return {
        genres: Array.isArray(parsed.genres) ? parsed.genres : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags : []
      }
    }
  } catch {
    // ignore
  }
  return { genres: [], tags: [] }
}

export default function Library(): JSX.Element {
  const [entriesById, setEntriesById] = useState<Record<string, AnimeEntry>>({})
  const [hasLoadedCache, setHasLoadedCache] = useState(false)
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [unfinished, setUnfinished] = useState<VideoProgress[]>([])
  const [allProgress, setAllProgress] = useState<VideoProgress[]>([])
  const initialSort = loadSortPref()
  const [sortKey, setSortKey] = useState<SortKey>(initialSort.sortKey)
  const [sortDir, setSortDir] = useState<SortDir>(initialSort.sortDir)
  const initialFilter = loadFilterPref()
  const [selectedGenres, setSelectedGenres] = useState<string[]>(initialFilter.genres)
  const [selectedTags, setSelectedTags] = useState<string[]>(initialFilter.tags)
  const navigate = useNavigate()

  useEffect(() => {
    try {
      localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ sortKey, sortDir }))
    } catch {
      // ignore
    }
  }, [sortKey, sortDir])

  useEffect(() => {
    try {
      localStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify({ genres: selectedGenres, tags: selectedTags })
      )
    } catch {
      // ignore
    }
  }, [selectedGenres, selectedTags])

  async function refreshUnfinished(): Promise<void> {
    try {
      const [unf, all] = await Promise.all([
        api.listUnfinishedVideos(),
        api.listVideoProgress()
      ])
      setUnfinished(unf)
      setAllProgress(all)
    } catch (err) {
      console.error(err)
    }
  }

  function upsertEntry(entry: AnimeEntry): void {
    setEntriesById((prev) => ({ ...prev, [entry.id]: entry }))
  }

  async function refresh(): Promise<void> {
    if (loading) return
    setLoading(true)
    try {
      await api.scanLibrary()
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const unsubItem = api.onLibraryItem(upsertEntry)
    const unsubDone = api.onLibraryDone(() => setLoading(false))

    void (async () => {
      try {
        const [cached, libRoots] = await Promise.all([api.cachedLibrary(), api.listLibraryRoots()])
        setRoots(libRoots)
        setEntriesById((prev) => {
          const next = { ...prev }
          for (const e of cached) next[e.id] = e
          return next
        })
      } catch (err) {
        console.error(err)
      } finally {
        setHasLoadedCache(true)
      }
      void refresh()
      void refreshUnfinished()
    })()

    // Keep the sidebar fresh while the user is browsing so positions from
    // another window / a just-closed player show up quickly.
    const poll = window.setInterval(refreshUnfinished, 4000)
    const onFocus = (): void => void refreshUnfinished()
    window.addEventListener('focus', onFocus)

    return () => {
      unsubItem()
      unsubDone()
      window.clearInterval(poll)
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const latestWatchedByEntry = useMemo(() => {
    // For each video path the user has opened, remember the most recent
    // updatedAt. Then roll up per AnimeEntry by taking the max across its videos.
    const byPath: Record<string, number> = {}
    for (const p of allProgress) {
      const key = `${p.serverId}::${p.path}`
      const prev = byPath[key] ?? 0
      if (p.updatedAt > prev) byPath[key] = p.updatedAt
    }
    const byEntry: Record<string, number> = {}
    for (const entry of Object.values(entriesById)) {
      let max = 0
      for (const v of entry.videos) {
        const t = byPath[`${entry.serverId}::${v.path}`] ?? 0
        if (t > max) max = t
      }
      if (max > 0) byEntry[entry.id] = max
    }
    return byEntry
  }, [allProgress, entriesById])

  const entries = useMemo(() => {
    const list = Object.values(entriesById)
    const dir = sortDir === 'asc' ? 1 : -1
    const byName = (a: AnimeEntry, b: AnimeEntry): number =>
      (a.metadata?.title ?? a.folderName).localeCompare(b.metadata?.title ?? b.folderName)
    const compareNumeric = (
      a: AnimeEntry,
      b: AnimeEntry,
      pick: (e: AnimeEntry) => number | undefined
    ): number => {
      const av = pick(a)
      const bv = pick(b)
      const ax = av ?? Number.NEGATIVE_INFINITY
      const bx = bv ?? Number.NEGATIVE_INFINITY
      if (ax === bx) return byName(a, b)
      return ax < bx ? -1 : 1
    }
    list.sort((a, b) => {
      let base: number
      switch (sortKey) {
        case 'rating':
          base = compareNumeric(a, b, (e) => e.metadata?.score)
          break
        case 'year':
          base = compareNumeric(a, b, (e) => e.metadata?.year)
          break
        case 'episodes':
          base = compareNumeric(a, b, (e) => e.metadata?.episodes)
          break
        case 'watched':
          base = compareNumeric(a, b, (e) => latestWatchedByEntry[e.id])
          break
        case 'added':
          base = compareNumeric(a, b, (e) => e.lastScannedAt)
          break
        case 'name':
        default:
          return byName(a, b) * dir
      }
      return base * dir
    })
    return list
  }, [entriesById, sortKey, sortDir, latestWatchedByEntry])

  const { availableGenres, availableTags } = useMemo(() => {
    const genres = new Set<string>()
    const tags = new Set<string>()
    for (const e of Object.values(entriesById)) {
      for (const g of e.metadata?.genres ?? []) genres.add(g)
      for (const t of e.metadata?.tags ?? []) tags.add(t)
    }
    return {
      availableGenres: Array.from(genres).sort((a, b) => a.localeCompare(b)),
      availableTags: Array.from(tags).sort((a, b) => a.localeCompare(b))
    }
  }, [entriesById])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hasQuery = q.length > 0
    const hasGenreFilter = selectedGenres.length > 0
    const hasTagFilter = selectedTags.length > 0
    if (!hasQuery && !hasGenreFilter && !hasTagFilter) return entries
    return entries.filter((e) => {
      if (hasQuery) {
        const title = (e.metadata?.title ?? e.folderName).toLowerCase()
        if (!title.includes(q) && !e.folderName.toLowerCase().includes(q)) return false
      }
      if (hasGenreFilter) {
        const genres = e.metadata?.genres ?? []
        if (!selectedGenres.every((g) => genres.includes(g))) return false
      }
      if (hasTagFilter) {
        const tags = e.metadata?.tags ?? []
        if (!selectedTags.every((t) => tags.includes(t))) return false
      }
      return true
    })
  }, [entries, query, selectedGenres, selectedTags])

  function toggleGenre(genre: string): void {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    )
  }

  function toggleTag(tag: string): void {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  function clearFilters(): void {
    setSelectedGenres([])
    setSelectedTags([])
  }

  if (!hasLoadedCache) {
    return (
      <div className="page">
        <div className="empty">Loading library…</div>
      </div>
    )
  }

  const hasNoRoots = roots.length === 0

  return (
    <div className="page library-page">
      <div className="library-main">
        <div className="page-header">
          <h1>Library</h1>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 12px',
                color: 'var(--text)',
                outline: 'none',
                minWidth: 220
              }}
            />
            <select
              aria-label="Sort by"
              value={sortKey}
              onChange={(e) => {
                const next = e.target.value as SortKey
                setSortKey(next)
                setSortDir(DEFAULT_DIR[next])
              }}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 10px',
                color: 'var(--text)',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  Sort: {o.label}
                </option>
              ))}
            </select>
            <button
              className="button secondary"
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
              aria-label={`Toggle sort direction (currently ${sortDir === 'asc' ? 'ascending' : 'descending'})`}
              style={{ padding: '8px 12px' }}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
            <button className="button secondary" onClick={refresh} disabled={loading}>
              {loading ? 'Scanning…' : 'Rescan'}
            </button>
          </div>
        </div>

        <FilterBar
          availableGenres={availableGenres}
          availableTags={availableTags}
          selectedGenres={selectedGenres}
          selectedTags={selectedTags}
          onToggleGenre={toggleGenre}
          onToggleTag={toggleTag}
          onClear={clearFilters}
        />

        {hasNoRoots && entries.length === 0 && (
          <div className="empty">
            No library folders yet.{' '}
            <a onClick={() => navigate('/servers')}>Add a server</a> and point it at a folder like
            <code> /Anime/Movies</code>.
          </div>
        )}

        {!hasNoRoots && filtered.length === 0 && (
          <div className="empty">
            {loading ? 'Fetching metadata…' : 'No anime found in the configured folders.'}
          </div>
        )}

        {filtered.length > 0 && (
          <VirtualGrid
            items={filtered}
            getKey={(e) => e.id}
            renderItem={(entry) => <AnimeCard entry={entry} />}
          />
        )}
      </div>

      <ContinueWatching items={unfinished} />
    </div>
  )
}

function VirtualGrid<T>({
  items,
  getKey,
  renderItem,
  minColumnWidth = 180,
  gap = 20,
  overscanRows = 2,
  pageSize = 60
}: {
  items: T[]
  getKey: (item: T) => string
  renderItem: (item: T) => JSX.Element
  minColumnWidth?: number
  gap?: number
  overscanRows?: number
  pageSize?: number
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [containerOffset, setContainerOffset] = useState(0)
  const [visibleCount, setVisibleCount] = useState(pageSize)

  const totalItems = items.length
  const effectiveVisibleCount = Math.min(visibleCount, totalItems)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    let p: HTMLElement | null = el.parentElement
    while (p) {
      const s = getComputedStyle(p)
      if (/(auto|scroll|overlay)/.test(s.overflowY)) {
        setScrollParent(p)
        return
      }
      p = p.parentElement
    }
    setScrollParent(document.scrollingElement as HTMLElement)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !scrollParent) return

    const update = (): void => {
      const parentRect = scrollParent.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      setContainerWidth(el.clientWidth)
      setScrollTop(scrollParent.scrollTop)
      setViewportHeight(scrollParent.clientHeight)
      setContainerOffset(elRect.top - parentRect.top + scrollParent.scrollTop)
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    ro.observe(scrollParent)
    scrollParent.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      scrollParent.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [scrollParent])

  const columns = Math.max(
    1,
    Math.floor((containerWidth + gap) / (minColumnWidth + gap))
  )
  const cardWidth =
    containerWidth > 0 ? (containerWidth - gap * (columns - 1)) / columns : minColumnWidth

  // Estimate: poster is 2/3 aspect ratio + ~80px body (title 2 lines + meta + padding).
  const estimatedRowHeight = cardWidth * 1.5 + 80
  const rowHeight = measuredRowHeight ?? estimatedRowHeight
  const stride = rowHeight + gap

  const totalRows = Math.ceil(effectiveVisibleCount / columns)
  const totalHeight = totalRows > 0 ? totalRows * rowHeight + (totalRows - 1) * gap : 0

  const relativeScrollTop = Math.max(0, scrollTop - containerOffset)
  const firstRow = Math.max(0, Math.floor(relativeScrollTop / stride) - overscanRows)
  const lastRow = Math.min(
    Math.max(0, totalRows - 1),
    Math.ceil((relativeScrollTop + viewportHeight) / stride) + overscanRows
  )

  useEffect(() => {
    if (visibleCount >= totalItems) return
    if (totalRows === 0) return
    if (lastRow >= totalRows - overscanRows - 1) {
      setVisibleCount((c) => Math.min(totalItems, c + pageSize))
    }
  }, [lastRow, totalRows, totalItems, visibleCount, overscanRows, pageSize])

  // Clamp visibleCount down when the underlying list shrinks (e.g. filtering).
  useEffect(() => {
    if (visibleCount > totalItems && totalItems > 0) {
      setVisibleCount(Math.max(pageSize, totalItems))
    }
  }, [totalItems, visibleCount, pageSize])

  // Invalidate measured height when card width changes so it gets remeasured.
  useEffect(() => {
    setMeasuredRowHeight(null)
  }, [cardWidth])

  const measureRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && measuredRowHeight == null) {
        const h = el.getBoundingClientRect().height
        if (h > 0) setMeasuredRowHeight(h)
      }
    },
    [measuredRowHeight]
  )

  const visible: Array<{ row: number; col: number; item: T }> = []
  for (let r = firstRow; r <= lastRow; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c
      if (i >= effectiveVisibleCount) break
      visible.push({ row: r, col: c, item: items[i] })
    }
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: totalHeight }}
    >
      {visible.map(({ row, col, item }, i) => (
        <div
          key={getKey(item)}
          ref={i === 0 ? measureRef : undefined}
          style={{
            position: 'absolute',
            top: row * stride,
            left: col * (cardWidth + gap),
            width: cardWidth
          }}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  )
}

function ContinueWatching({ items }: { items: VideoProgress[] }): JSX.Element {
  const navigate = useNavigate()

  function play(p: VideoProgress): void {
    const q = new URLSearchParams({
      path: p.path,
      size: String(p.size),
      title: p.videoName,
      animeTitle: p.animeTitle
    })
    if (p.posterPath) q.set('poster', p.posterPath)
    navigate(`/player/${encodeURIComponent(p.serverId)}?${q.toString()}`)
  }

  return (
    <aside className="continue-side">
      <h3>Continue Watching</h3>
      {items.length === 0 && (
        <div className="continue-empty">Nothing in progress yet.</div>
      )}
      <div className="continue-list">
        {items.map((p) => {
          const poster = localFileUrl(p.posterPath)
          const ratio =
            p.durationSeconds > 0
              ? Math.min(100, (p.positionSeconds / p.durationSeconds) * 100)
              : 0
          return (
            <div
              key={`${p.serverId}::${p.path}`}
              className="continue-item"
              onClick={() => play(p)}
            >
              <div
                className="continue-poster"
                style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
              >
                {!poster && <span>🎬</span>}
              </div>
              <div className="continue-body">
                <div className="continue-title">{p.animeTitle}</div>
                <div className="continue-episode">{p.videoName}</div>
                <div className="continue-meta">
                  {formatWatchedTime(p.positionSeconds)}
                  {p.durationSeconds > 0 ? ` / ${formatWatchedTime(p.durationSeconds)}` : ''}
                </div>
                <div className="continue-progress">
                  <div className="continue-progress-bar" style={{ width: `${ratio}%` }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function FilterBar({
  availableGenres,
  availableTags,
  selectedGenres,
  selectedTags,
  onToggleGenre,
  onToggleTag,
  onClear
}: {
  availableGenres: string[]
  availableTags: string[]
  selectedGenres: string[]
  selectedTags: string[]
  onToggleGenre: (g: string) => void
  onToggleTag: (t: string) => void
  onClear: () => void
}): JSX.Element | null {
  if (availableGenres.length === 0 && availableTags.length === 0) return null
  const hasActive = selectedGenres.length > 0 || selectedTags.length > 0
  return (
    <div className="filter-bar">
      {availableGenres.length > 0 && (
        <FilterGroup
          label="Genre"
          options={availableGenres}
          selected={selectedGenres}
          onToggle={onToggleGenre}
        />
      )}
      {availableTags.length > 0 && (
        <FilterGroup
          label="Tag"
          options={availableTags}
          selected={selectedTags}
          onToggle={onToggleTag}
        />
      )}
      {hasActive && (
        <button className="filter-clear" onClick={onClear} type="button">
          Clear filters
        </button>
      )}
    </div>
  )
}

function FilterGroup({
  label,
  options,
  selected,
  onToggle
}: {
  label: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(ev: MouseEvent): void {
      if (!containerRef.current) return
      if (!containerRef.current.contains(ev.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const summary =
    selected.length === 0
      ? `All ${label.toLowerCase()}s`
      : selected.length === 1
        ? selected[0]
        : `${selected.length} ${label.toLowerCase()}s`

  return (
    <div className="filter-group" ref={containerRef}>
      <button
        type="button"
        className={`filter-trigger${selected.length > 0 ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="filter-trigger-label">{label}:</span>
        <span className="filter-trigger-value">{summary}</span>
        <span className="filter-trigger-caret">▾</span>
      </button>
      {open && (
        <div className="filter-menu" role="listbox">
          {options.map((opt) => {
            const checked = selected.includes(opt)
            return (
              <label key={opt} className={`filter-option${checked ? ' checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(opt)}
                />
                <span>{opt}</span>
              </label>
            )
          })}
        </div>
      )}
      {selected.length > 0 && (
        <div className="filter-chips">
          {selected.map((v) => (
            <button
              key={v}
              type="button"
              className="filter-chip"
              onClick={() => onToggle(v)}
              title="Remove filter"
            >
              {v}
              <span className="filter-chip-x">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AnimeCard({ entry }: { entry: AnimeEntry }): JSX.Element {
  const navigate = useNavigate()
  const title = entry.metadata?.title ?? entry.folderName
  const poster = localFileUrl(entry.metadata?.posterPath)

  return (
    <div
      className="card"
      onClick={() => {
        const q = new URLSearchParams({ path: entry.path })
        navigate(
          `/anime/${encodeURIComponent(entry.serverId)}/${encodeURIComponent(entry.libraryRootId)}?${q.toString()}`
        )
      }}
    >
      <div
        className="card-poster"
        style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
      >
        {!poster && <div className="card-poster-placeholder">🎬</div>}
      </div>
      <div className="card-body">
        <div className="card-title">{title}</div>
        <div className="card-meta">
          {entry.metadata?.year ? `${entry.metadata.year} · ` : ''}
          {entry.metadata?.type ?? 'Folder'}
          {entry.metadata?.score ? ` · ⭐ ${entry.metadata.score}` : ''}
        </div>
      </div>
    </div>
  )
}
