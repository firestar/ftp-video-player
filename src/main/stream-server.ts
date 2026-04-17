import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AddressInfo } from 'node:net'
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
    const subtitles: SubtitleTrackInfo[] = streams
      .filter((s) => s.codec_type === 'subtitle')
      .map((s) => ({
        index: s.index,
        codec: s.codec_name ?? 'unknown',
        language: s.tags?.language,
        title: s.tags?.title,
        isDefault: s.disposition?.default === 1
      }))

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
    '-reconnect_delay_max', '4'
  ]
  if (seek > 0) {
    args.push('-ss', String(seek))
  }
  args.push('-i', selfUrl(token))

  // Stream mapping: take the first video + audio streams. If a subtitle index
  // was requested we burn it in, otherwise the renderer overlays external VTT.
  if (subIndex !== null && subIndex !== '' && /^\d+$/.test(subIndex)) {
    args.push(
      '-filter_complex',
      `[0:v][0:s:${subIndex}]overlay[v]`,
      '-map', '[v]',
      '-map', '0:a:0?'
    )
  } else {
    args.push('-map', '0:v:0', '-map', '0:a:0?')
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
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
 * Extract a single embedded subtitle track and serve it as WebVTT. The track
 * index refers to the stream index reported by /probe.
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

  res.setHeader('Content-Type', 'text/vtt; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.statusCode = 200

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', selfUrl(token),
    '-map', `0:${streamIndex}`,
    '-c:s', 'webvtt',
    '-f', 'webvtt',
    'pipe:1'
  ]

  const proc = spawn(ffmpegPath, args)
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
  proc.on('close', () => {
    res.end()
  })

  proc.stdout.pipe(res)
  proc.stderr.on('data', (chunk: Buffer) => {
    const msg = chunk.toString('utf8').trim()
    if (msg) console.error('[subtitle]', msg)
  })

  req.on('close', cleanup)
  res.on('close', cleanup)
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
