import { useEffect, useMemo, useState } from 'react'
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

      <div className="grid">
        {filtered.map((entry) => (
          <AnimeCard key={entry.id} entry={entry} />
        ))}
      </div>
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
