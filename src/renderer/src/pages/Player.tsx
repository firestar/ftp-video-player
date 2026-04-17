import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'

export default function Player(): JSX.Element {
  const params = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)

  const serverId = decodeURIComponent(params.serverId ?? '')
  const path = search.get('path') ?? ''
  const size = Number(search.get('size') ?? 0)
  const title = search.get('title') ?? path

  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let activeToken: string | null = null
    ;(async () => {
      try {
        const handle = await api.registerStream(serverId, path, size)
        activeToken = handle.token
        setToken(handle.token)
        setStreamUrl(handle.url)
      } catch (err) {
        setError((err as Error).message)
      }
    })()
    return () => {
      if (activeToken) api.unregisterStream(activeToken).catch(() => undefined)
    }
  }, [serverId, path, size])

  return (
    <div className="player-page">
      <div className="player-topbar">
        <button className="button ghost" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
      </div>
      {error && <div className="empty" style={{ margin: 24 }}>Error: {error}</div>}
      {streamUrl && (
        <video
          ref={videoRef}
          className="player-video"
          src={streamUrl}
          controls
          autoPlay
          onError={(e) => {
            const err = (e.currentTarget as HTMLVideoElement).error
            setError(
              err
                ? `Playback failed (code ${err.code}). The container/codec may not be supported by Electron. MKV with H.264+AAC tends to work; other codecs may require transcoding.`
                : 'Playback failed'
            )
          }}
        />
      )}
      {!streamUrl && !error && <div className="empty" style={{ margin: 24 }}>Connecting…</div>}
    </div>
  )
}
