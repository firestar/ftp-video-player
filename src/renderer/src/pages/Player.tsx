import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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

/**
 * Renders the active cues of any `showing` text track as an overlay over the
 * video. Simpler than Video.js's built-in TextTrackDisplay — the overlay sits
 * center-bottom by default, and honors WebVTT `position` / `line` / `align`
 * when the cue carries positioning data.
 */
function SubtitleOverlay({ player }: { player: Player | null }): JSX.Element | null {
  const [cues, setCues] = useState<VTTCue[]>([])

  useEffect(() => {
    if (!player) return
    const tracks = player.textTracks() as unknown as TextTrackList
    const attached = new Set<TextTrack>()

    const refresh = (): void => {
      const active: VTTCue[] = []
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i]
        if (t.mode !== 'showing' || !t.activeCues) continue
        for (let j = 0; j < t.activeCues.length; j++) {
          active.push(t.activeCues[j] as VTTCue)
        }
      }
      setCues(active)
    }

    const sync = (): void => {
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i]
        if (attached.has(t)) continue
        attached.add(t)
        t.addEventListener('cuechange', refresh)
      }
      refresh()
    }

    tracks.addEventListener('addtrack', sync)
    tracks.addEventListener('removetrack', refresh)
    tracks.addEventListener('change', refresh)
    sync()

    return () => {
      tracks.removeEventListener('addtrack', sync)
      tracks.removeEventListener('removetrack', refresh)
      tracks.removeEventListener('change', refresh)
      for (const t of attached) t.removeEventListener('cuechange', refresh)
    }
  }, [player])

  if (cues.length === 0) return null
  // Some ASS→WebVTT conversions (and multi-layer sub tracks) emit the same
  // line twice with identical text at the same timestamp. Collapse those so
  // we don't stack identical captions on top of each other.
  const seen = new Set<string>()
  const stacked: VTTCue[] = []
  const positioned: VTTCue[] = []
  for (const cue of cues) {
    const key = `${cue.text}|${cue.position}|${cue.line}`
    if (seen.has(key)) continue
    seen.add(key)
    if (cuePosition(cue)) positioned.push(cue)
    else stacked.push(cue)
  }
  return (
    <div className="subtitle-overlay">
      {stacked.length > 0 && (
        <div className="subtitle-stack">
          {stacked.map((cue, i) => (
            <SubtitleCue key={`s-${cue.startTime}-${i}`} cue={cue} />
          ))}
        </div>
      )}
      {positioned.map((cue, i) => (
        <SubtitleCue key={`p-${cue.startTime}-${i}`} cue={cue} />
      ))}
    </div>
  )
}

function cuePosition(cue: VTTCue): { left?: number; top?: number } | null {
  const out: { left?: number; top?: number } = {}
  if (typeof cue.position === 'number') out.left = clamp(cue.position, 0, 100)
  // WebVTT `line` is a percentage from the top when snapToLines is false, and
  // a line index (0 = top, negative = from bottom) when true. ffmpeg's
  // ASS→WebVTT conversion emits top-of-screen signs as `line:0` with
  // snapToLines on; collapsing those into the default bottom stack causes
  // signs to overlap dialogue, so we treat non-negative line indices as
  // top-anchored to keep signs visually separated from dialogue.
  if (typeof cue.line === 'number') {
    if (!cue.snapToLines) {
      out.top = clamp(cue.line, 0, 100)
    } else if (cue.line >= 0) {
      out.top = clamp(5 + cue.line * 6, 0, 90)
    }
  }
  return out.left === undefined && out.top === undefined ? null : out
}

/**
 * Shift every timestamp in a WebVTT document by `-offsetSeconds`, dropping
 * cues that end before 0. Used in transcode mode: ffmpeg's output restarts
 * the media clock at 0 when invoked with `-ss`, but the subtitle track was
 * extracted from the full source and still uses original timestamps. Without
 * this shift, cues fire `offsetSeconds` seconds after the matching frame.
 */
function shiftVtt(vtt: string, offsetSeconds: number): string {
  if (offsetSeconds <= 0) return vtt
  const TIMESTAMP_RE = /(?:\d+:)?\d{2}:\d{2}\.\d{3}/g
  // Cue blocks are separated by blank lines. Drop cues whose end time would
  // fall before zero; shift every timestamp (cue timing + inline karaoke
  // markers) in surviving blocks.
  const blocks = vtt.split(/\r?\n\r?\n/)
  const out: string[] = []
  for (const block of blocks) {
    const timingLineMatch = block.match(
      /^.*?((?:\d+:)?\d{2}:\d{2}\.\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}\.\d{3}).*$/m
    )
    if (!timingLineMatch) {
      out.push(block)
      continue
    }
    if (parseVttTime(timingLineMatch[2]) <= offsetSeconds) continue
    const shifted = block.replace(TIMESTAMP_RE, (m) =>
      formatVttTime(Math.max(0, parseVttTime(m) - offsetSeconds))
    )
    out.push(shifted)
  }
  return out.join('\n\n')
}

function parseVttTime(s: string): number {
  const m = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(s)
  if (!m) return 0
  const [, h, mm, ss, ms] = m
  return (
    (h ? Number(h) * 3600 : 0) +
    Number(mm) * 60 +
    Number(ss) +
    Number(ms) / 1000
  )
}

function formatVttTime(total: number): string {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total - Math.floor(total)) * 1000)
  const pad = (n: number, w = 2): string => n.toString().padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`
}

function SubtitleCue({ cue }: { cue: VTTCue }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.textContent = ''
    el.appendChild(cue.getCueAsHTML())
  }, [cue])

  const pos = cuePosition(cue)
  const style: CSSProperties = {}
  if (pos?.left !== undefined) style.left = `${pos.left}%`
  if (pos?.top !== undefined) style.top = `${pos.top}%`
  if (cue.align === 'start' || cue.align === 'left') style.textAlign = 'left'
  else if (cue.align === 'end' || cue.align === 'right') style.textAlign = 'right'

  return (
    <div
      ref={ref}
      className={pos ? 'subtitle-cue positioned' : 'subtitle-cue'}
      style={style}
    />
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
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
  // Tracks the src we've already auto-started, so mode switches replay the
  // new source exactly once while respecting a user's subsequent pause.
  const autoplayedSrcRef = useRef<string | null>(null)

  const [handle, setHandle] = useState<StreamHandle | null>(null)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [mode, setMode] = useState<PlaybackMode>('direct')
  const [error, setError] = useState<string | null>(null)
  const [probing, setProbing] = useState(true)
  // Mirrors playerRef so children (the subtitle overlay) re-render with the
  // Video.js instance once it's created.
  const [playerInstance, setPlayerInstance] = useState<Player | null>(null)
  // Raw WebVTT text for each prefetched track, keyed by ffprobe stream index.
  // We fetch and buffer the whole VTT before attaching the <track> so Video.js
  // can't silently drop a slow/failed HTTP track load. Storing the raw text
  // (rather than just a blob URL) lets us re-shift timestamps when the
  // transcode seek offset changes without refetching over FTP.
  const [subtitleTexts, setSubtitleTexts] = useState<Map<number, string>>(new Map())
  // Blob URLs derived from `subtitleTexts` shifted by the current transcode
  // offset. Separated out so seeking in transcode mode only re-shifts in
  // memory instead of triggering another ffmpeg extraction.
  const [subtitleBlobs, setSubtitleBlobs] = useState<Map<number, string>>(new Map())
  // Flips to true once the text-subtitle prefetch settles (or when the file
  // has no text subs). Playback waits on this so captions are ready before
  // the first frame plays.
  const [subtitlesLoaded, setSubtitlesLoaded] = useState(false)
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
    if (!handle || !probe) return null
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
  }, [handle, mode, path, transcodeStart, probe])

  // 2) Create / update the Video.js player whenever the source changes.
  useEffect(() => {
    if (!videoElRef.current || !currentSrc) return

    if (!playerRef.current) {
      const vjsPlayer = videojs(videoElRef.current, {
        controls: true,
        // Autoplay is gated manually once subtitles (if any) are ready —
        // see the playback-start effect below.
        autoplay: false,
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
      setPlayerInstance(vjsPlayer)
    }

    const player = playerRef.current
    player.src(currentSrc)

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

  // 3a) Prefetch each text subtitle as raw WebVTT text.
  // Doing the fetch ourselves (instead of letting Video.js's internal text
  // track loader pull the HTTP URL) is the difference between captions
  // rendering and silent failure: Video.js swallows XHR errors, and the
  // /subtitle endpoint can take a while because ffmpeg has to stream the
  // whole MKV over FTP before it emits any cues.
  useEffect(() => {
    if (!handle || !probe) return
    setSubtitlesLoaded(false)
    const textTracks = probe.subtitles.filter((s) => s.textBased)
    if (textTracks.length === 0) {
      setSubtitleTexts(new Map())
      setSubtitlesLoaded(true)
      return
    }

    let cancelled = false

    ;(async () => {
      const entries = await Promise.all(
        textTracks.map(async (sub) => {
          const url = `${handle.subtitleUrl}/${sub.index}`
          try {
            const res = await fetch(url)
            if (!res.ok) {
              const tail = (await res.text()).slice(0, 500)
              console.error(`[subs] fetch ${sub.index} failed ${res.status}: ${tail}`)
              return null
            }
            const text = await res.text()
            return [sub.index, text] as const
          } catch (err) {
            console.error(`[subs] fetch ${sub.index} error`, err)
            return null
          }
        })
      )
      if (cancelled) return
      const next = new Map<number, string>()
      for (const entry of entries) {
        if (entry) next.set(entry[0], entry[1])
      }
      setSubtitleTexts(next)
      setSubtitlesLoaded(true)
    })()

    return () => {
      cancelled = true
    }
  }, [handle, probe])

  // 3a') Derive blob URLs for each track, shifted by the current transcode
  // offset. In transcode mode the video's native currentTime resets to 0 on
  // every seek while cue timestamps stay in the original file's timeline, so
  // without this shift cues fire `transcodeStart` seconds after the matching
  // frame.
  useEffect(() => {
    const offset = mode === 'transcode' ? transcodeStart : 0
    const created: string[] = []
    const next = new Map<number, string>()
    for (const [idx, raw] of subtitleTexts) {
      const shifted = shiftVtt(raw, offset)
      const blob = new Blob([shifted], { type: 'text/vtt' })
      const url = URL.createObjectURL(blob)
      created.push(url)
      next.set(idx, url)
    }
    setSubtitleBlobs(next)
    return () => {
      for (const u of created) URL.revokeObjectURL(u)
    }
  }, [subtitleTexts, mode, transcodeStart])

  // 3b) Attach the prefetched tracks to the player.
  useEffect(() => {
    const player = playerRef.current
    if (!player || !handle || !probe) return

    const existing = player.remoteTextTracks()
    for (let i = existing.length - 1; i >= 0; i--) {
      const tt = (existing as unknown as { [n: number]: unknown })[i]
      if (tt) player.removeRemoteTextTrack(tt as unknown as HTMLTrackElement)
    }

    // Bitmap formats (PGS/DVD/DVB) can't be served as WebVTT, so they don't
    // belong in the captions menu — they would attach as silent phantom tracks
    // and starve real text subs of the default-selection slot. Bitmap subs
    // require burn-in via the transcode endpoint instead.
    const textTracks = probe.subtitles.filter(
      (s) => s.textBased && subtitleBlobs.has(s.index)
    )
    if (textTracks.length === 0) return

    // Pick the track to show by default: the ffprobe-flagged default track,
    // or fall back to the first one so users always see subtitles when the
    // file has them.
    const preferred = textTracks.findIndex((s) => s.isDefault)
    const activeIndex = preferred >= 0 ? preferred : 0

    textTracks.forEach((sub, i) => {
      const src = subtitleBlobs.get(sub.index)
      if (!src) return
      const trackEl = player.addRemoteTextTrack(
        {
          kind: 'subtitles',
          src,
          srclang: languageFromTrack(sub),
          label: subtitleLabel(sub),
          default: i === activeIndex
        },
        false
      ) as unknown as HTMLTrackElement
      trackEl?.addEventListener('error', (e) => {
        console.error(`[subs] track load error idx=${sub.index}`, e)
      })
      // `default: true` alone is unreliable once metadata has loaded; force
      // the mode so the active track actually renders over the video.
      const textTrack = trackEl?.track
      if (textTrack) {
        textTrack.mode = i === activeIndex ? 'showing' : 'disabled'
      }
    })
  }, [handle, probe, subtitleBlobs, currentSrc])

  // 3c) Start playback once subtitles are ready. Autoplay is disabled on the
  // player so the first frame never plays uncaptioned; we kick it off manually
  // after the VTT prefetch settles. Triggers once per source (mode switches
  // rebuild currentSrc and retry); user-initiated pauses are respected.
  useEffect(() => {
    if (!playerInstance || !currentSrc || !subtitlesLoaded) return
    if (autoplayedSrcRef.current === currentSrc.src) return
    autoplayedSrcRef.current = currentSrc.src
    playerInstance.play()?.catch(() => undefined)
  }, [playerInstance, currentSrc, subtitlesLoaded])

  // Track whether Video.js is stalled waiting on the network so the loading
  // bar can reappear during mid-playback buffering (e.g. FTP throttling or
  // transcode seeks where ffmpeg needs a moment to emit the next fragment).
  const [buffering, setBuffering] = useState(true)
  useEffect(() => {
    const p = playerInstance
    if (!p) return
    const onWaiting = (): void => setBuffering(true)
    const onReady = (): void => setBuffering(false)
    p.on('waiting', onWaiting)
    p.on('loadstart', onWaiting)
    p.on('playing', onReady)
    p.on('canplay', onReady)
    return () => {
      p.off('waiting', onWaiting)
      p.off('loadstart', onWaiting)
      p.off('playing', onReady)
      p.off('canplay', onReady)
    }
  }, [playerInstance])

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
        <div className="player-loading">
          <div className="loading-bar" />
          <div className="player-loading-text">Probing stream…</div>
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
          <SubtitleOverlay player={playerInstance} />
          {(!subtitlesLoaded || buffering) && <div className="loading-bar overlay" />}
        </div>
      )}
    </div>
  )
}
