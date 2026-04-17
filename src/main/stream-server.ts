import http from 'node:http'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
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

const CONTENT_TYPES: Record<string, string> = {
  mkv: 'video/x-matroska',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t'
}

function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

/** Register a stream and return a tokenized URL for the renderer's <video>. */
export function registerStream(input: { serverId: string; path: string; size: number }): {
  url: string
  token: string
} {
  const token = randomUUID()
  registrations.set(token, { token, ...input })
  return { url: `http://127.0.0.1:${port}/stream/${token}`, token }
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

export function startStreamServer(): Promise<number> {
  if (httpServer) return Promise.resolve(port)
  httpServer = http.createServer((req, res) => {
    if (!req.url?.startsWith('/stream/')) {
      res.statusCode = 404
      res.end()
      return
    }
    const token = req.url.replace('/stream/', '').split('?')[0]
    void handleStream(req, res, token)
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
