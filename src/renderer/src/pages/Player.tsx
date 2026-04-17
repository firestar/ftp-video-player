import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import videojs from 'video.js'
import type Player from 'video.js/dist/types/player'
import 'video.js/dist/video-js.css'
import type { ProbeResult, StreamHandle, SubtitleTrackInfo } from '@shared/types'
import { api } from '../api'

type PlaybackMode = 'direct' | 'transcode'

function subtitleLabel(track: SubtitleTrackInfo): string {
  const parts: string[] = []
  if (track.title) parts.push(track.title)
  if (track.language) parts.push(track.language.toUpperCase())
  if (parts.length === 0) parts.push(`Track ${track.index}`)
  parts.push(`(${track.codec})`)
  return parts.join(' · ')
}

function languageFromTrack(track: SubtitleTrackInfo): string {
  return track.language || 'und'
}

export default function PlayerPage(): JSX.Element {
  const params = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()

  const serverId = decodeURIComponent(params.serverId ?? '')
  const path = search.get('path') ?? ''
  const size = Number(search.get('size') ?? 0)
  const title = search.get('title') ?? path

  const containerRef = useRef<HTMLDivElement>(null)
  const videoElRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<Player | null>(null)

  const [handle, setHandle] = useState<StreamHandle | null>(null)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [mode, setMode] = useState<PlaybackMode>('direct')
  const [error, setError] = useState<string | null>(null)
  const [probing, setProbing] = useState(true)

  // 1) Register the stream and fetch the probe.
  useEffect(() => {
    let cancelled = false
    let activeToken: string | null = null

    ;(async () => {
      try {
        const h = await api.registerStream(serverId, path, size)
        if (cancelled) {
          api.unregisterStream(h.token).catch(() => undefined)
          return
        }
        activeToken = h.token
        setHandle(h)

        setProbing(true)
        const res = await fetch(h.probeUrl)
        if (!res.ok) throw new Error(`probe failed (${res.status})`)
        const data = (await res.json()) as ProbeResult
        if (cancelled) return
        setProbe(data)
        setMode(data.directPlayable ? 'direct' : 'transcode')
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setProbing(false)
      }
    })()

    return () => {
      cancelled = true
      if (activeToken) api.unregisterStream(activeToken).catch(() => undefined)
    }
  }, [serverId, path, size])

  const currentSrc = useMemo(() => {
    if (!handle) return null
    if (mode === 'transcode') {
      return { src: handle.transcodeUrl, type: 'video/mp4' as const }
    }
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const mime =
      ext === 'webm'
        ? 'video/webm'
        : ext === 'mkv'
          ? 'video/x-matroska'
          : ext === 'mov'
            ? 'video/quicktime'
            : 'video/mp4'
    return { src: handle.directUrl, type: mime }
  }, [handle, mode, path])

  // 2) Create / update the Video.js player whenever the source changes.
  useEffect(() => {
    if (!videoElRef.current || !currentSrc) return

    if (!playerRef.current) {
      const vjsPlayer = videojs(videoElRef.current, {
        controls: true,
        autoplay: true,
        preload: 'auto',
        fluid: false,
        playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
        html5: {
          nativeTextTracks: false
        },
        userActions: {
          hotkeys: true
        }
      })

      vjsPlayer.on('error', () => {
        const err = vjsPlayer.error()
        // When the direct source can't be decoded by Chromium, fall back to
        // the transcoded stream automatically.
        if (mode === 'direct' && err && (err.code === 3 || err.code === 4)) {
          vjsPlayer.error(undefined as never)
          setMode('transcode')
          return
        }
        if (err) {
          setError(`Playback error (${err.code}): ${err.message ?? 'unknown'}`)
        }
      })

      playerRef.current = vjsPlayer
    }

    const player = playerRef.current
    player.src(currentSrc)
    player.play()?.catch(() => undefined)
  }, [currentSrc, mode])

  // 3) Attach embedded subtitle tracks as remote <track>s.
  useEffect(() => {
    const player = playerRef.current
    if (!player || !handle || !probe) return

    const existing = player.remoteTextTracks()
    for (let i = existing.length - 1; i >= 0; i--) {
      const tt = (existing as unknown as { [n: number]: unknown })[i]
      if (tt) player.removeRemoteTextTrack(tt as unknown as HTMLTrackElement)
    }

    probe.subtitles.forEach((sub) => {
      player.addRemoteTextTrack(
        {
          kind: 'subtitles',
          src: `${handle.subtitleUrl}/${sub.index}`,
          srclang: languageFromTrack(sub),
          label: subtitleLabel(sub),
          default: sub.isDefault
        },
        false
      )
    })
  }, [handle, probe])

  // 4) Dispose on unmount.
  useEffect(() => {
    return () => {
      const p = playerRef.current
      if (p) {
        try {
          p.dispose()
        } catch {
          // ignore
        }
        playerRef.current = null
      }
    }
  }, [])

  const codecSummary = probe
    ? [
        probe.videoCodec ? `video: ${probe.videoCodec}` : null,
        probe.audioCodec ? `audio: ${probe.audioCodec}` : null,
        probe.subtitles.length > 0 ? `${probe.subtitles.length} subs` : null
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <div className="player-page" ref={containerRef}>
      <div className="player-topbar">
        <button className="button ghost" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {title}
        </div>
        {codecSummary && <div className="player-meta">{codecSummary}</div>}
        {probe && (
          <div className="player-mode">
            <button
              className={`button ${mode === 'direct' ? '' : 'ghost'}`}
              onClick={() => setMode('direct')}
              disabled={!probe.directPlayable && mode !== 'direct'}
              title={
                probe.directPlayable
                  ? 'Stream the raw file; full seeking.'
                  : 'Codec not natively supported by the browser.'
              }
            >
              Direct
            </button>
            <button
              className={`button ${mode === 'transcode' ? '' : 'ghost'}`}
              onClick={() => setMode('transcode')}
              title="Re-encode on the fly to H.264/AAC via ffmpeg."
            >
              Transcode
            </button>
          </div>
        )}
      </div>

      {error && <div className="empty" style={{ margin: 24 }}>Error: {error}</div>}

      {probing && !error && (
        <div className="empty" style={{ margin: 24 }}>
          Probing stream…
        </div>
      )}

      {handle && !error && (
        <div data-vjs-player className="player-video-wrap">
          <video
            ref={videoElRef}
            className="video-js vjs-big-play-centered player-video"
            playsInline
            crossOrigin="anonymous"
          />
        </div>
      )}
    </div>
  )
}
