import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { VideoProgress } from '@shared/types'
import { api, localFileUrl } from '../api'
import { formatWatchedTime } from './Anime'

export default function ContinueWatching(): JSX.Element {
  const [items, setItems] = useState<VideoProgress[]>([])
  const [loaded, setLoaded] = useState(false)
  const navigate = useNavigate()

  async function refresh(): Promise<void> {
    try {
      const list = await api.listUnfinishedVideos()
      setItems(list)
    } catch (err) {
      console.error(err)
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    void refresh()
    const poll = window.setInterval(refresh, 4000)
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(poll)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

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
    <div className="page">
      <div className="page-header">
        <h1>Continue Watching</h1>
      </div>

      {loaded && items.length === 0 && (
        <div className="empty">Nothing in progress yet.</div>
      )}

      {items.length > 0 && (
        <div className="continue-grid">
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
      )}
    </div>
  )
}
