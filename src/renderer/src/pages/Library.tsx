import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AnimeEntry, LibraryRoot } from '@shared/types'
import { api, localFileUrl } from '../api'

export default function Library(): JSX.Element {
  const [entriesById, setEntriesById] = useState<Record<string, AnimeEntry>>({})
  const [hasLoadedCache, setHasLoadedCache] = useState(false)
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

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
    })()

    return () => {
      unsubItem()
      unsubDone()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const entries = useMemo(() => {
    const list = Object.values(entriesById)
    list.sort((a, b) =>
      (a.metadata?.title ?? a.folderName).localeCompare(b.metadata?.title ?? b.folderName)
    )
    return list
  }, [entriesById])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => {
      const title = (e.metadata?.title ?? e.folderName).toLowerCase()
      return title.includes(q) || e.folderName.toLowerCase().includes(q)
    })
  }, [entries, query])

  if (!hasLoadedCache) {
    return (
      <div className="page">
        <div className="empty">Loading library…</div>
      </div>
    )
  }

  const hasNoRoots = roots.length === 0

  return (
    <div className="page">
      <div className="page-header">
        <h1>Library</h1>
        <div style={{ display: 'flex', gap: 10 }}>
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
          <button className="button secondary" onClick={refresh} disabled={loading}>
            {loading ? 'Scanning…' : 'Rescan'}
          </button>
        </div>
      </div>

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
        </div>
      </div>
    </div>
  )
}
