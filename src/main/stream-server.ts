import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import type { Readable } from 'node:stream'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { ProbeResult, SubtitleTrackInfo } from '@shared/types'
import { getServer } from './store.js'
import { createFtpClient, type IFtpClient } from './ftp/client.js'

interface Registration {
  token: string
  serverId: string
  path: string
  size: number
  /** Populated by /probe; maps stream index → ffprobe codec_name. */
  subtitleCodecs?: Map<number, string>
  /** Cached WebVTT output from the batch extractor, keyed by stream index. */
  subtitlesCache?: Record<number, string>
  /** In-flight batch extraction; dedupes concurrent requests. */
  subtitlesInflight?: Promise<Record<number, string>>
}

const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'webvtt',
  'mov_text',
  'tx3g',
  'text',
  'microdvd'
])

function isTextSubtitle(codec: string | undefined): boolean {
  return !!codec && TEXT_SUBTITLE_CODECS.has(codec.toLowerCase())
}

const registrations = new Map<string, Registration>()
let httpServer: http.Server | null = null
let port = 0

const ffmpegPath = resolveBinary(ffmpegStatic as unknown as string | null)
const ffprobePath = resolveBinary(ffprobeStatic.path)
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath)

function resolveBinary(p: string | null | undefined): string | undefined {
  if (!p) return undefined
  return p.replace('app.asar', 'app.asar.unpacked')
}

const CONTENT_TYPES: Record<string, string> = {
  mkv: 'video/x-matroska',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv'
}

// Codecs that Chromium in Electron can decode directly. Everything else goes
// through the ffmpeg transcoder.
const DIRECT_VIDEO_CODECS = new Set(['h264', 'avc1', 'vp8', 'vp9', 'av1'])
const DIRECT_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
const DIRECT_CONTAINERS = new Set(['mp4', 'm4v', 'webm', 'mkv'])

function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

export function getStreamPort(): number {
  return port
}

function selfUrl(token: string): string {
  return `http://127.0.0.1:${port}/stream/${token}`
}

/** Register a stream and return tokenized URLs for the renderer. */
export function registerStream(input: { serverId: string; path: string; size: number }): {
  token: string
  directUrl: string
  transcodeUrl: string
  probeUrl: string
  subtitleUrl: string
  subtitlesUrl: string
  /** @deprecated kept for backward compatibility with older renderer code */
  url: string
} {
  const token = randomUUID()
  registrations.set(token, { token, ...input })
  const base = `http://127.0.0.1:${port}`
  return {
    token,
    directUrl: `${base}/stream/${token}`,
    transcodeUrl: `${base}/transcode/${token}`,
    probeUrl: `${base}/probe/${token}`,
    subtitleUrl: `${base}/subtitle/${token}`,
    subtitlesUrl: `${base}/subtitles/${token}`,
    url: `${base}/stream/${token}`
  }
}

export function unregisterStream(token: string): void {
  registrations.delete(token)
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header || !header.startsWith('bytes=')) return null
  const [startStr, endStr] = header.replace('bytes=', '').split('-')
  const start = startStr ? parseInt(startStr, 10) : 0
  const end = endStr ? parseInt(endStr, 10) : size - 1
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) return null
  return { start, end }
}

async function handleStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string
): Promise<void> {
  const reg = registrations.get(token)
  if (!reg) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const ftpServer = getServer(reg.serverId)
  if (!ftpServer) {
    res.statusCode = 404
    res.end('server missing')
    return
  }

  const range = parseRange(req.headers.range, reg.size) ?? { start: 0, end: reg.size - 1 }
  const length = range.end - range.start + 1

  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', contentTypeFor(reg.path))
  res.setHeader('Content-Length', String(length))
  if (req.headers.range) {
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${reg.size}`)
  } else {
    res.statusCode = 200
  }

  let client: IFtpClient | undefined
  try {
    client = await createFtpClient(ftpServer)
    await client.connect()
    const stream = await client.createReadStream(reg.path, { start: range.start, end: range.end })
    req.on('close', () => {
      stream.destroy()
    })
    stream.on('error', (err) => {
      console.error('[stream] source error', err)
      res.destroy(err)
    })
    stream.pipe(res)
    await new Promise<void>((resolve) => {
      res.on('close', resolve)
      res.on('finish', resolve)
    })
  } catch (err) {
    console.error('[stream] failure', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.end('stream error')
    } else {
      res.destroy(err as Error)
    }
  } finally {
    client?.disconnect().catch(() => undefined)
  }
}

function deriveDirectPlayable(
  videoCodec: string | undefined,
  audioCodec: string | undefined,
  filePath: string
): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (!DIRECT_CONTAINERS.has(ext)) return false
  if (videoCodec && !DIRECT_VIDEO_CODECS.has(videoCodec.toLowerCase())) return false
  if (audioCodec && !DIRECT_AUDIO_CODECS.has(audioCodec.toLowerCase())) return false
  return true
}

async function handleProbe(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string
): Promise<void> {
  const reg = registrations.get(token)
  if (!reg) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  if (!ffprobePath) {
    res.statusCode = 500
    res.end('ffprobe missing')
    return
  }

  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    '-probesize', '10000000',
    '-analyzeduration', '10000000',
    // Our /stream endpoint serves byte ranges, so let ffprobe seek — AVI
    // stores its `idx1` chunk at the end of the file, and without seek it
    // never finds the index.
    '-seekable', '1',
    selfUrl(token)
  ]

  const proc = spawn(ffprobePath, args)
  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8')
  })
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })

  proc.on('error', (err) => {
    console.error('[probe] spawn error', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.end('probe spawn failed')
    }
  })

  proc.on('close', (code) => {
    if (code !== 0) {
      console.error('[probe] ffprobe exited', code, stderr)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('probe failed')
      }
      return
    }
    let parsed: {
      format?: { format_name?: string; duration?: string }
      streams?: Array<{
        index: number
        codec_type?: string
        codec_name?: string
        disposition?: { default?: number }
        tags?: { language?: string; title?: string }
      }>
    }
    try {
      parsed = JSON.parse(stdout)
    } catch (err) {
      console.error('[probe] json parse', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('probe parse failed')
      }
      return
    }

    const streams = parsed.streams ?? []
    const video = streams.find((s) => s.codec_type === 'video')
    const audio = streams.find((s) => s.codec_type === 'audio')
    const subtitleStreams = streams.filter((s) => s.codec_type === 'subtitle')
    const subtitles: SubtitleTrackInfo[] = subtitleStreams.map((s) => ({
      index: s.index,
      codec: s.codec_name ?? 'unknown',
      language: s.tags?.language,
      title: s.tags?.title,
      isDefault: s.disposition?.default === 1,
      textBased: isTextSubtitle(s.codec_name)
    }))

    // Cache codec_name per stream index so /subtitle and /transcode can decide
    // how to handle each track without re-probing.
    const codecMap = new Map<number, string>()
    for (const s of subtitleStreams) {
      if (s.codec_name) codecMap.set(s.index, s.codec_name)
    }
    reg.subtitleCodecs = codecMap

    const result: ProbeResult = {
      container: parsed.format?.format_name,
      duration: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
      videoCodec: video?.codec_name,
      audioCodec: audio?.codec_name,
      subtitles,
      directPlayable: deriveDirectPlayable(video?.codec_name, audio?.codec_name, reg.path)
    }

    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 200
    res.end(JSON.stringify(result))
  })
}

/**
 * Transcode the source to fragmented MP4 (H.264 + AAC) on the fly. ffmpeg
 * reads from our own /stream/:token endpoint so it can issue HTTP byte-range
 * requests to seek within the input.
 */
async function handleTranscode(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string
): Promise<void> {
  const reg = registrations.get(token)
  if (!reg) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  if (!ffmpegPath) {
    res.statusCode = 500
    res.end('ffmpeg missing')
    return
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const seek = Math.max(0, Number(url.searchParams.get('seek') ?? '0') || 0)
  const subIndex = url.searchParams.get('sub')

  res.setHeader('Content-Type', 'video/mp4')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Connection', 'keep-alive')
  res.statusCode = 200

  const args: string[] = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '4',
    // AVI's `idx1` chunk lives at the end of the file; ffmpeg has to seek
    // there before it can decode. Our /stream endpoint honors byte ranges,
    // so tell ffmpeg the input is seekable.
    '-seekable', '1'
  ]
  if (seek > 0) {
    args.push('-ss', String(seek))
  }
  args.push('-i', selfUrl(token))

  // Stream mapping: take the first video + audio streams. If a subtitle index
  // was requested we burn it in, otherwise the renderer overlays external VTT.
  // The `sub` query param is the GLOBAL ffprobe stream index; ffmpeg's filters
  // want a subtitle-relative index (0 = first sub stream), so we resolve that
  // here using the codec cache populated by /probe.
  let burnedIn = false
  if (subIndex !== null && subIndex !== '' && /^\d+$/.test(subIndex)) {
    const globalIdx = Number(subIndex)
    const codec = await getSubtitleCodec(reg, globalIdx)
    const subIndices = [...(reg.subtitleCodecs?.keys() ?? [])].sort((a, b) => a - b)
    const relIdx = subIndices.indexOf(globalIdx)
    if (relIdx >= 0) {
      if (isTextSubtitle(codec)) {
        // For text subs, the `subtitles` filter renders ASS/SRT to video.
        // Colons and other punctuation in the input URL must be escaped for
        // the filter parser.
        const escaped = selfUrl(token).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
        args.push('-vf', `subtitles='${escaped}':si=${relIdx}`, '-map', '0:v:0', '-map', '0:a:0?')
      } else {
        // Bitmap subs (PGS/DVD/DVB) decode to image frames; overlay composites
        // them on the primary video.
        args.push(
          '-filter_complex',
          `[0:v][0:s:${relIdx}]overlay[v]`,
          '-map', '[v]',
          '-map', '0:a:0?'
        )
      }
      burnedIn = true
    }
  }
  if (!burnedIn) {
    args.push('-map', '0:v:0', '-map', '0:a:0?')
  }

  args.push(
    '-c:v', 'libx264',
    // `medium` + CRF 18 is the widely accepted "visually lossless" recipe
    // for x264; the output is indistinguishable from the source for the vast
    // majority of content while still fitting in a streamable bitrate.
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '256k',
    '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1'
  )

  const proc: ChildProcessWithoutNullStreams = spawn(ffmpegPath, args)
  let cleaned = false
  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    try {
      proc.kill('SIGKILL')
    } catch {
      // ignore
    }
  }

  proc.stderr.on('data', (chunk: Buffer) => {
    // ffmpeg emits progress on stderr; only log when something looks wrong.
    const msg = chunk.toString('utf8')
    if (/error|Invalid|failed/i.test(msg)) {
      console.error('[transcode]', msg.trim())
    }
  })
  proc.on('error', (err) => {
    console.error('[transcode] spawn error', err)
    cleanup()
    if (!res.headersSent) {
      res.statusCode = 500
      res.end('transcode error')
    } else {
      res.destroy()
    }
  })
  proc.on('close', (code) => {
    if (code !== 0 && !res.writableEnded) {
      console.error('[transcode] ffmpeg exited with', code)
    }
    res.end()
  })

  proc.stdout.pipe(res)

  req.on('close', cleanup)
  res.on('close', cleanup)
}

/**
 * Look up the ffprobe codec_name for a subtitle stream. Uses the cache
 * populated by /probe; if the cache is empty (renderer hit /subtitle first),
 * runs a minimal ffprobe to populate it.
 */
async function getSubtitleCodec(
  reg: Registration,
  streamIndex: number
): Promise<string | undefined> {
  if (reg.subtitleCodecs?.has(streamIndex)) {
    return reg.subtitleCodecs.get(streamIndex)
  }
  if (!ffprobePath) return undefined
  const codecs = await new Promise<Map<number, string>>((resolve) => {
    const proc = spawn(ffprobePath, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 's',
      selfUrl(reg.token)
    ])
    let stdout = ''
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    proc.on('error', () => resolve(new Map()))
    proc.on('close', () => {
      const map = new Map<number, string>()
      try {
        const parsed = JSON.parse(stdout) as {
          streams?: Array<{ index: number; codec_name?: string }>
        }
        for (const s of parsed.streams ?? []) {
          if (s.codec_name) map.set(s.index, s.codec_name)
        }
      } catch {
        // ignore
      }
      resolve(map)
    })
  })
  reg.subtitleCodecs = codecs
  return codecs.get(streamIndex)
}

/**
 * Extract a single embedded subtitle track and serve it as WebVTT. The track
 * index refers to the stream index reported by /probe.
 *
 * We open our own FTP read stream and pipe it into ffmpeg's stdin rather than
 * pointing ffmpeg at `/stream/<token>`. Going back through our HTTP endpoint
 * would cause ffmpeg's byte-range seeks to spawn additional FTP sessions for
 * every request, and anime FTP servers commonly cap concurrent sessions at
 * 1–2 — the extra connections deadlock against the already-open video stream
 * and the subtitle fetch stalls forever with no visible error.
 */
async function handleSubtitle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
  indexStr: string
): Promise<void> {
  const reg = registrations.get(token)
  if (!reg) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  if (!ffmpegPath) {
    res.statusCode = 500
    res.end('ffmpeg missing')
    return
  }
  const streamIndex = parseInt(indexStr, 10)
  if (!Number.isFinite(streamIndex) || streamIndex < 0) {
    res.statusCode = 400
    res.end('bad index')
    return
  }

  // WebVTT is text-only — bitmap formats (PGS/DVD/DVB/XSUB) can't be encoded
  // to it. Refuse before sending headers so the browser sees a real error
  // instead of a 200 OK with an empty/invalid WebVTT body.
  const codec = await getSubtitleCodec(reg, streamIndex)
  if (!isTextSubtitle(codec)) {
    res.statusCode = 415
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end(`subtitle codec ${codec ?? 'unknown'} cannot be served as WebVTT`)
    return
  }

  const ftpServer = getServer(reg.serverId)
  if (!ftpServer) {
    res.statusCode = 404
    res.end('server missing')
    return
  }

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-probesize', '10M',
    '-analyzeduration', '10M',
    '-i', 'pipe:0',
    '-map', `0:${streamIndex}`,
    '-c:s', 'webvtt',
    '-f', 'webvtt',
    'pipe:1'
  ]

  const proc = spawn(ffmpegPath, args)
  let bytesWritten = 0
  let stderrTail = ''
  let cleaned = false
  let ftpClient: IFtpClient | undefined
  let ftpStream: Readable | undefined

  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    try {
      proc.kill('SIGKILL')
    } catch {
      // ignore
    }
    try {
      ftpStream?.destroy()
    } catch {
      // ignore
    }
    ftpClient?.disconnect().catch(() => undefined)
  }

  proc.on('error', (err) => {
    console.error('[subtitle] spawn error', err)
    cleanup()
    if (!res.headersSent) {
      res.statusCode = 500
      res.end('subtitle error')
    } else {
      res.destroy()
    }
  })
  proc.on('close', (code) => {
    if (code !== 0 && bytesWritten === 0) {
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(`subtitle conversion failed (code ${code}): ${stderrTail.trim() || 'no stderr'}`)
      }
    }
    cleanup()
  })

  proc.stdout.on('data', (chunk: Buffer) => {
    if (bytesWritten === 0) {
      // First bytes arrived — commit to a 200 WebVTT response.
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.statusCode = 200
    }
    bytesWritten += chunk.length
  })
  proc.stdout.pipe(res)
  proc.stderr.on('data', (chunk: Buffer) => {
    const msg = chunk.toString('utf8')
    stderrTail = (stderrTail + msg).slice(-2000)
    const trimmed = msg.trim()
    if (trimmed) console.error('[subtitle]', trimmed)
  })

  req.on('close', cleanup)
  res.on('close', cleanup)

  // Pipe the FTP read into ffmpeg's stdin. Errors on either side tear the
  // whole pipeline down via cleanup().
  try {
    ftpClient = await createFtpClient(ftpServer)
    await ftpClient.connect()
    ftpStream = await ftpClient.createReadStream(reg.path)
    ftpStream.on('error', (err) => {
      console.error('[subtitle] ftp stream error', err)
      try {
        proc.stdin.destroy(err)
      } catch {
        // ignore
      }
    })
    proc.stdin.on('error', () => {
      // EPIPE when ffmpeg exits before we finish writing; just tear down.
      ftpStream?.destroy()
    })
    ftpStream.pipe(proc.stdin)
  } catch (err) {
    console.error('[subtitle] ftp open failed', err)
    cleanup()
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`subtitle source open failed: ${(err as Error).message}`)
    } else {
      res.destroy()
    }
  }
}

/**
 * Extract every text-based embedded subtitle track in a single ffmpeg pass and
 * return them as a JSON map keyed by stream index.
 *
 * The older /subtitle/{token}/{index} endpoint spawns one ffmpeg + one FTP
 * connection per track, each of which has to stream the entire video file
 * just to pull out a single subtitle stream. For a 12 GB MKV with three
 * subtitle tracks that's ~36 GB of data transfer and three processes fighting
 * over the server's concurrent-session cap.
 *
 * Here we open ONE FTP read, pipe it into ONE ffmpeg process with multiple
 * `-map … -c:s webvtt output.vtt` targets, and read all outputs at once.
 * Results are cached on the Registration so repeated fetches (e.g. retries
 * or mode switches) don't re-extract.
 */
async function handleSubtitlesBatch(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string
): Promise<void> {
  const reg = registrations.get(token)
  if (!reg) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  if (!ffmpegPath) {
    res.statusCode = 500
    res.end('ffmpeg missing')
    return
  }

  try {
    const result = await extractAllSubtitles(reg)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.statusCode = 200
    res.end(JSON.stringify(result))
  } catch (err) {
    console.error('[subtitles-batch] failed', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`subtitles batch failed: ${(err as Error).message}`)
    } else {
      res.destroy()
    }
  }
}

async function extractAllSubtitles(
  reg: Registration
): Promise<Record<number, string>> {
  if (reg.subtitlesCache) return reg.subtitlesCache
  if (reg.subtitlesInflight) return reg.subtitlesInflight

  const run = (async (): Promise<Record<number, string>> => {
    // Make sure we know the codec of every subtitle stream. /probe normally
    // populates this; if it hasn't run yet we fall back to a minimal ffprobe.
    if (!reg.subtitleCodecs) {
      // getSubtitleCodec populates reg.subtitleCodecs as a side-effect.
      await getSubtitleCodec(reg, -1)
    }
    const codecs = reg.subtitleCodecs ?? new Map<number, string>()
    const textIndices: number[] = []
    for (const [idx, codec] of codecs) {
      if (isTextSubtitle(codec)) textIndices.push(idx)
    }
    textIndices.sort((a, b) => a - b)
    if (textIndices.length === 0) return {}

    const ftpServer = getServer(reg.serverId)
    if (!ftpServer) throw new Error('server missing')
    if (!ffmpegPath) throw new Error('ffmpeg missing')

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ftpvp-subs-'))
    const outputs = textIndices.map((idx) => ({
      idx,
      file: path.join(tmpDir, `${idx}.vtt`)
    }))

    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-probesize', '10M',
      '-analyzeduration', '10M',
      '-i', 'pipe:0',
      '-y'
    ]
    for (const { idx, file } of outputs) {
      args.push('-map', `0:${idx}`, '-c:s', 'webvtt', '-f', 'webvtt', file)
    }

    const proc = spawn(ffmpegPath, args)
    let ftpClient: IFtpClient | undefined
    let ftpStream: Readable | undefined
    let stderrTail = ''
    let torn = false

    const teardown = (): void => {
      if (torn) return
      torn = true
      try {
        proc.kill('SIGKILL')
      } catch {
        // ignore
      }
      try {
        ftpStream?.destroy()
      } catch {
        // ignore
      }
      ftpClient?.disconnect().catch(() => undefined)
    }

    proc.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf8')
      stderrTail = (stderrTail + msg).slice(-2000)
      const trimmed = msg.trim()
      if (trimmed) console.error('[subtitles-batch]', trimmed)
    })

    try {
      ftpClient = await createFtpClient(ftpServer)
      await ftpClient.connect()
      ftpStream = await ftpClient.createReadStream(reg.path)
      ftpStream.on('error', (err) => {
        try {
          proc.stdin.destroy(err)
        } catch {
          // ignore
        }
      })
      proc.stdin.on('error', () => {
        ftpStream?.destroy()
      })
      ftpStream.pipe(proc.stdin)

      const exitCode = await new Promise<number>((resolve, reject) => {
        proc.once('error', reject)
        proc.once('close', (code) => resolve(code ?? 1))
      })

      if (exitCode !== 0) {
        throw new Error(
          `ffmpeg exited ${exitCode}${stderrTail.trim() ? `: ${stderrTail.trim()}` : ''}`
        )
      }

      const result: Record<number, string> = {}
      await Promise.all(
        outputs.map(async ({ idx, file }) => {
          try {
            result[idx] = await fs.promises.readFile(file, 'utf8')
          } catch (err) {
            console.error(`[subtitles-batch] read ${idx} failed`, err)
          }
        })
      )

      reg.subtitlesCache = result
      return result
    } finally {
      teardown()
      fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })()

  reg.subtitlesInflight = run
  try {
    return await run
  } finally {
    reg.subtitlesInflight = undefined
  }
}

function setCors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Range')
  res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length')
}

export function startStreamServer(): Promise<number> {
  if (httpServer) return Promise.resolve(port)
  httpServer = http.createServer((req, res) => {
    setCors(res)
    const url = req.url ?? ''

    if (url.startsWith('/stream/')) {
      const token = url.replace('/stream/', '').split('?')[0]
      void handleStream(req, res, token)
      return
    }
    if (url.startsWith('/probe/')) {
      const token = url.replace('/probe/', '').split('?')[0]
      void handleProbe(req, res, token)
      return
    }
    if (url.startsWith('/transcode/')) {
      const rest = url.replace('/transcode/', '')
      const token = rest.split('?')[0]
      void handleTranscode(req, res, token)
      return
    }
    if (url.startsWith('/subtitles/')) {
      const token = url.replace('/subtitles/', '').split('?')[0].split('/')[0]
      if (!token) {
        res.statusCode = 400
        res.end('bad url')
        return
      }
      void handleSubtitlesBatch(req, res, token)
      return
    }
    if (url.startsWith('/subtitle/')) {
      const rest = url.replace('/subtitle/', '').split('?')[0]
      const [token, indexStr] = rest.split('/')
      if (!token || indexStr === undefined) {
        res.statusCode = 400
        res.end('bad url')
        return
      }
      void handleSubtitle(req, res, token, indexStr)
      return
    }

    res.statusCode = 404
    res.end()
  })
  return new Promise((resolve, reject) => {
    httpServer!.once('error', reject)
    httpServer!.listen(0, '127.0.0.1', () => {
      port = (httpServer!.address() as AddressInfo).port
      resolve(port)
    })
  })
}

export function stopStreamServer(): void {
  httpServer?.close()
  httpServer = null
  port = 0
  registrations.clear()
}
