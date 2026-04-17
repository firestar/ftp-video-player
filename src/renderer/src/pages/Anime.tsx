import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { AnimeEntry, AnimeMetadata, VideoFile } from '@shared/types'
import { api, localFileUrl } from '../api'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function Anime(): JSX.Element {
  const params = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()

  const serverId = decodeURIComponent(params.serverId ?? '')
  const libraryRootId = decodeURIComponent(params.libraryRootId ?? '')
  const folderPath = search.get('path') ?? '/'

  const [entry, setEntry] = useState<AnimeEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<AnimeMetadata[] | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  async function load(): Promise<void> {
    setError(null)
    try {
      const cached = await api.cachedAnime(serverId, folderPath, libraryRootId)
      if (cached) setEntry(cached)
      else setEntry(null)
    } catch {
      // ignore — will be replaced by live load
    }
    try {
      const loaded = await api.loadAnime(serverId, folderPath, libraryRootId)
      if (!loaded) throw new Error('Could not load anime')
      setEntry(loaded)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, folderPath, libraryRootId])

  useEffect(() => {
    if (!entry) return
    ;(async () => {
      for (const video of entry.videos) {
        if (thumbs[video.path]) continue
        const path = await api.generateThumbnail(serverId, video.path).catch(() => undefined)
        if (path) setThumbs((prev) => ({ ...prev, [video.path]: path }))
      }
    })()
  }, [entry, serverId])

  async function handleSearchMetadata(): Promise<void> {
    if (!entry) return
    const query = window.prompt('Search MyAnimeList for…', entry.metadata?.title ?? entry.folderName)
    if (!query) return
    setSearching(true)
    try {
      const matches = await api.searchAnime(query)
      setResults(matches)
    } finally {
      setSearching(false)
    }
  }

  async function handlePickMetadata(choice: AnimeMetadata): Promise<void> {
    if (!entry) return
    const updated = await api.overrideMetadata(entry.serverId, entry.path, choice)
    setEntry({ ...entry, metadata: updated })
    setResults(null)
  }

  function handlePlay(video: VideoFile): void {
    const q = new URLSearchParams({
      path: video.path,
      size: String(video.size),
      title: video.name
    })
    navigate(`/player/${encodeURIComponent(serverId)}?${q.toString()}`)
  }

  if (error) {
    return (
      <div className="page">
        <div className="empty">Error: {error}</div>
      </div>
    )
  }

  if (!entry) {
    return (
      <div className="page">
        <div className="empty">Loading…</div>
      </div>
    )
  }

  const poster = localFileUrl(entry.metadata?.posterPath)
  const title = entry.metadata?.title ?? entry.folderName

  return (
    <div className="page">
      <button className="button ghost" onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
        ← Back
      </button>

      <div className="anime-detail">
        <div>
          <div
            className="poster"
            style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
          />
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="button secondary" onClick={handleSearchMetadata} disabled={searching}>
              {searching ? 'Searching…' : 'Change metadata'}
            </button>
          </div>
        </div>
        <div>
          <h1>{title}</h1>
          <div className="subtitle">
            {entry.metadata?.englishTitle && entry.metadata.englishTitle !== title && (
              <>{entry.metadata.englishTitle} · </>
            )}
            {entry.metadata?.year ? `${entry.metadata.year} · ` : ''}
            {entry.metadata?.type ?? 'Folder'}
            {entry.metadata?.episodes ? ` · ${entry.metadata.episodes} eps` : ''}
            {entry.metadata?.score ? ` · ⭐ ${entry.metadata.score}` : ''}
          </div>
          {entry.metadata?.genres && (
            <div style={{ marginBottom: 14 }}>
              {entry.metadata.genres.map((g) => (
                <span key={g} className="pill">
                  {g}
                </span>
              ))}
            </div>
          )}
          {entry.metadata?.synopsis && <div className="synopsis">{entry.metadata.synopsis}</div>}

          <h3 style={{ marginTop: 22, marginBottom: 10 }}>Videos ({entry.videos.length})</h3>
          <div className="episode-list">
            {entry.videos.map((video) => {
              const thumb = localFileUrl(thumbs[video.path])
              return (
                <div key={video.path} className="episode" onClick={() => handlePlay(video)}>
                  <div
                    className={`episode-thumb${thumb ? '' : ' placeholder'}`}
                    style={thumb ? { backgroundImage: `url("${thumb}")` } : undefined}
                  >
                    {!thumb && <span>Generating…</span>}
                  </div>
                  <div>
                    <div className="episode-title">{video.name}</div>
                    <div className="episode-meta">{formatSize(video.size)}</div>
                  </div>
                  <button className="button">Play</button>
                </div>
              )
            })}
          </div>
          {entry.videos.length === 0 && (
            <div className="empty">No video files found in this folder.</div>
          )}
        </div>
      </div>

      {results !== null && (
        <div className="modal-backdrop" onClick={() => setResults(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h2>Pick a match</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 540, overflow: 'auto' }}>
              {results.length === 0 && <div className="empty">No results.</div>}
              {results.map((r) => (
                <div
                  key={r.malId ?? r.title}
                  className="server-row"
                  style={{ display: 'grid', gridTemplateColumns: '60px 1fr auto', cursor: 'pointer' }}
                  onClick={() => handlePickMetadata(r)}
                >
                  <div
                    style={{
                      width: 60,
                      height: 90,
                      background: `url(${r.imageUrl}) center/cover`,
                      borderRadius: 4
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>{r.title}</div>
                    <div className="meta">
                      {r.year ?? '?'} · {r.type ?? ''} {r.episodes ? `· ${r.episodes} eps` : ''}
                    </div>
                    <div className="meta" style={{ marginTop: 4 }}>
                      {r.synopsis?.slice(0, 160)}…
                    </div>
                  </div>
                  <button className="button">Use</button>
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button className="button ghost" onClick={() => setResults(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
