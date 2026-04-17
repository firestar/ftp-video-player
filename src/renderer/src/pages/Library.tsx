import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AnimeEntry, LibraryRoot, VideoProgress } from '@shared/types'
import { api, localFileUrl } from '../api'
import { formatWatchedTime } from './Anime'

export default function Library(): JSX.Element {
  const [entriesById, setEntriesById] = useState<Record<string, AnimeEntry>>({})
  const [hasLoadedCache, setHasLoadedCache] = useState(false)
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [unfinished, setUnfinished] = useState<VideoProgress[]>([])
  const navigate = useNavigate()

  async function refreshUnfinished(): Promise<void> {
    try {
      const list = await api.listUnfinishedVideos()
      setUnfinished(list)
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
    <div className="page library-page">
      <div className="library-main">
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

      <ContinueWatching items={unfinished} />
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
