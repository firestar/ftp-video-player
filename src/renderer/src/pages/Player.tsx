import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import videojs from 'video.js'
import type Player from 'video.js/dist/types/player'
import 'video.js/dist/video-js.css'
import type { ProbeResult, StreamHandle, SubtitleTrackInfo } from '@shared/types'
import { api } from '../api'

type PlaybackMode = 'direct' | 'transcode'

// A fragmented MP4 from ffmpeg has no duration in its moov and reports
// `Infinity` to the browser, which breaks the Video.js progress bar and seek
// controls. We work around that by tracking the `-ss` offset we asked ffmpeg
// to start from and patching the player's time/duration/seekable accessors so
// the UI sees a virtual timeline spanning the whole file.
function createFakeTimeRanges(start: number, end: number): TimeRanges {
  return {
    length: 1,
    start: (i: number) => {
      if (i !== 0) throw new Error('index out of bounds')
      return start
    },
    end: (i: number) => {
      if (i !== 0) throw new Error('index out of bounds')
      return end
    }
  } as TimeRanges
}

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
  const animeTitle = search.get('animeTitle') ?? title
  const poster = search.get('poster') ?? undefined

  const containerRef = useRef<HTMLDivElement>(null)
  const videoElRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<Player | null>(null)
  const hasResumedRef = useRef(false)
  // Set when a user-initiated seek triggers a transcode src reload, so the
  // next `loadedmetadata` doesn't bounce the position back to the stale
  // saved-progress value.
  const suppressResumeRef = useRef(false)

  const [handle, setHandle] = useState<StreamHandle | null>(null)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [mode, setMode] = useState<PlaybackMode>('direct')
  const [error, setError] = useState<string | null>(null)
  const [probing, setProbing] = useState(true)
  // Seconds of the source file the current transcode stream started at. When
  // the user seeks we bump this, which rebuilds the src with a new `?seek=`.
  const [transcodeStart, setTranscodeStart] = useState(0)

  // Refs mirror the reactive values above so the monkey-patched player
  // methods (installed once) always read the latest values.
  const modeRef = useRef(mode)
  const probeRef = useRef(probe)
  const transcodeStartRef = useRef(transcodeStart)
  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  useEffect(() => {
    probeRef.current = probe
  }, [probe])
  useEffect(() => {
    transcodeStartRef.current = transcodeStart
  }, [transcodeStart])

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

  // When switching modes or loading a new file, reset the transcode offset.
  useEffect(() => {
    setTranscodeStart(0)
  }, [mode, handle?.token])

  const currentSrc = useMemo(() => {
    if (!handle) return null
    if (mode === 'transcode') {
      const url =
        transcodeStart > 0
          ? `${handle.transcodeUrl}?seek=${transcodeStart}`
          : handle.transcodeUrl
      return { src: url, type: 'video/mp4' as const }
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
  }, [handle, mode, path, transcodeStart])

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

      // Patch the player's time/duration/seekable accessors so transcode mode
      // presents a virtual timeline covering the whole file, and so clicking
      // the seek bar triggers a re-transcode from the requested timestamp.
      const nativeDuration = vjsPlayer.duration.bind(vjsPlayer)
      const nativeCurrentTime = vjsPlayer.currentTime.bind(vjsPlayer)
      const nativeSeekable = vjsPlayer.seekable.bind(vjsPlayer)
      /* eslint-disable @typescript-eslint/no-explicit-any */
      ;(vjsPlayer as any).duration = (val?: number): any => {
        if (val !== undefined) return nativeDuration(val)
        const probeDur = probeRef.current?.duration
        if (modeRef.current === 'transcode' && probeDur && Number.isFinite(probeDur)) {
          return probeDur
        }
        return nativeDuration() ?? 0
      }
      ;(vjsPlayer as any).currentTime = (val?: number): any => {
        if (modeRef.current !== 'transcode') {
          if (val !== undefined) return nativeCurrentTime(val)
          return nativeCurrentTime() ?? 0
        }
        if (val === undefined) {
          const native = nativeCurrentTime() ?? 0
          return (Number.isFinite(native) ? native : 0) + transcodeStartRef.current
        }
        const probeDur = probeRef.current?.duration
        const max = probeDur && Number.isFinite(probeDur) ? probeDur : val
        const target = Math.max(0, Math.min(val, max))
        // Only reload if the delta is meaningful — tiny Video.js-internal nudges
        // (e.g. `currentTime(0)` right after src swap) shouldn't restart ffmpeg.
        if (Math.abs(target - transcodeStartRef.current) < 0.5) return vjsPlayer
        suppressResumeRef.current = true
        setTranscodeStart(target)
        return vjsPlayer
      }
      ;(vjsPlayer as any).seekable = (): TimeRanges => {
        const probeDur = probeRef.current?.duration
        if (modeRef.current === 'transcode' && probeDur && Number.isFinite(probeDur)) {
          return createFakeTimeRanges(0, probeDur)
        }
        return nativeSeekable()
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */

      vjsPlayer.on('error', () => {
        const err = vjsPlayer.error()
        // When the direct source can't be decoded by Chromium, fall back to
        // the transcoded stream automatically.
        if (modeRef.current === 'direct' && err && (err.code === 3 || err.code === 4)) {
          vjsPlayer.error(undefined as never)
          setMode('transcode')
          return
        }
        if (err) {
          setError(`Playback error (${err.code}): ${err.message ?? 'unknown'}`)
        }
      })

      const syncPlayingClass = (): void => {
        document.body.classList.toggle('video-playing', !vjsPlayer.paused())
      }
      vjsPlayer.on('play', syncPlayingClass)
      vjsPlayer.on('playing', syncPlayingClass)
      vjsPlayer.on('pause', syncPlayingClass)
      vjsPlayer.on('ended', syncPlayingClass)

      // On every `loadedmetadata` (initial load and mode switches), jump to the
      // most recently saved position for this file. Skipped for videos watched
      // past the 85% "finished" threshold so rewatches start from the top.
      vjsPlayer.on('loadedmetadata', () => {
        // Fragmented MP4 reports `Infinity` for duration — re-fire the
        // durationchange event so Video.js reads our patched value and renders
        // a normal progress bar instead of the live UI.
        if (modeRef.current === 'transcode') vjsPlayer.trigger('durationchange')

        // After a user-initiated transcode seek, don't let the resume-from-
        // saved-position logic drag the player back to the previous spot.
        if (suppressResumeRef.current) {
          suppressResumeRef.current = false
          hasResumedRef.current = true
          return
        }

        void (async () => {
          try {
            const saved = await api.getVideoProgress(serverId, path)
            if (!saved) return
            const duration = vjsPlayer.duration() ?? saved.durationSeconds
            if (!duration || saved.positionSeconds < 1) return
            const ratio = saved.positionSeconds / duration
            if (hasResumedRef.current) {
              // Mid-session src swap (e.g. direct → transcode): always restore.
              vjsPlayer.currentTime(saved.positionSeconds)
              return
            }
            if (ratio >= 0.85) return
            vjsPlayer.currentTime(saved.positionSeconds)
            hasResumedRef.current = true
          } catch {
            // ignore
          }
        })()
      })

      playerRef.current = vjsPlayer
    }

    const player = playerRef.current
    player.src(currentSrc)
    player.play()?.catch(() => undefined)

    const progressInterval = window.setInterval(() => {
      const p = playerRef.current
      if (!p) return
      const currentTime = p.currentTime() ?? 0
      const duration = p.duration() ?? 0
      if (!duration || !Number.isFinite(duration) || currentTime < 0.1) return
      api.setVideoProgress({
        serverId,
        path,
        size,
        positionSeconds: currentTime,
        durationSeconds: duration,
        updatedAt: Date.now(),
        videoName: title,
        animeTitle,
        posterPath: poster
      })
    }, 10)

    return () => {
      window.clearInterval(progressInterval)
    }
  }, [currentSrc, mode, serverId, path, size, title, animeTitle, poster])

  // 3) Attach embedded subtitle tracks as remote <track>s.
  useEffect(() => {
    const player = playerRef.current
    if (!player || !handle || !probe) return

    const existing = player.remoteTextTracks()
    for (let i = existing.length - 1; i >= 0; i--) {
      const tt = (existing as unknown as { [n: number]: unknown })[i]
      if (tt) player.removeRemoteTextTrack(tt as unknown as HTMLTrackElement)
    }

    if (probe.subtitles.length === 0) return

    // Pick the track to show by default: the ffprobe-flagged default track,
    // or fall back to the first one so users always see subtitles when the
    // file has them.
    const preferred = probe.subtitles.findIndex((s) => s.isDefault)
    const activeIndex = preferred >= 0 ? preferred : 0

    probe.subtitles.forEach((sub, i) => {
      const trackEl = player.addRemoteTextTrack(
        {
          kind: 'subtitles',
          src: `${handle.subtitleUrl}/${sub.index}`,
          srclang: languageFromTrack(sub),
          label: subtitleLabel(sub),
          default: i === activeIndex
        },
        false
      ) as unknown as HTMLTrackElement
      // `default: true` alone is unreliable once metadata has loaded; force
      // the mode so the active track actually renders over the video.
      const textTrack = trackEl?.track
      if (textTrack) {
        textTrack.mode = i === activeIndex ? 'showing' : 'disabled'
      }
    })
  }, [handle, probe])

  // 4) Dispose on unmount.
  useEffect(() => {
    return () => {
      document.body.classList.remove('video-playing')
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
