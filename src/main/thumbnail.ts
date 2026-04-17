import { promises as fs, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { app } from 'electron'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { FtpServerConfig } from '@shared/types'
import { createFtpClient } from './ftp/client.js'

const ffmpegPath = resolveBinary(ffmpegStatic as unknown as string | null)
const ffprobePath = resolveBinary(ffprobeStatic.path)
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath)

/** In packaged builds the binaries live under app.asar.unpacked. */
function resolveBinary(p: string | null | undefined): string | undefined {
  if (!p) return undefined
  return p.replace('app.asar', 'app.asar.unpacked')
}

function thumbnailsDir(): string {
  return path.join(app.getPath('userData'), 'thumbnails')
}

async function ensureThumbnailDir(): Promise<string> {
  const dir = thumbnailsDir()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function videoKey(serverId: string, remotePath: string): string {
  return createHash('sha1').update(`${serverId}:${remotePath}`).digest('hex')
}

/**
 * Download the first few MB of the remote video so ffmpeg can read a seekable
 * local file to produce a thumbnail. For very large or heavily-index-at-end
 * files (some MKV muxers put the index near the end) this may miss, but in
 * practice most anime encodes have a moov/index at the start.
 */
async function fetchHeadBytes(config: FtpServerConfig, remotePath: string, bytes: number): Promise<string> {
  const tempDir = path.join(app.getPath('temp'), 'ftp-anime-head')
  await fs.mkdir(tempDir, { recursive: true })
  const tempPath = path.join(tempDir, `${videoKey(config.id, remotePath)}.part`)

  const client = await createFtpClient(config)
  try {
    await client.connect()
    const stream = await client.createReadStream(remotePath, { start: 0, end: bytes - 1 })
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tempPath)
      stream.pipe(out)
      stream.on('error', reject)
      out.on('error', reject)
      out.on('finish', () => resolve())
    })
  } finally {
    await client.disconnect().catch(() => undefined)
  }
  return tempPath
}

export async function generateThumbnail(
  config: FtpServerConfig,
  remotePath: string,
  options: { timestampSeconds?: number; force?: boolean } = {}
): Promise<string | undefined> {
  const dir = await ensureThumbnailDir()
  const key = videoKey(config.id, remotePath)
  const outPath = path.join(dir, `${key}.jpg`)

  if (!options.force) {
    try {
      await fs.access(outPath)
      return outPath
    } catch {
      // fall through and generate
    }
  }

  const headPath = await fetchHeadBytes(config, remotePath, 24 * 1024 * 1024)
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(headPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .screenshots({
          timestamps: [options.timestampSeconds ?? 15],
          filename: path.basename(outPath),
          folder: dir,
          size: '480x?'
        })
    })
    return outPath
  } catch {
    return undefined
  } finally {
    fs.unlink(headPath).catch(() => undefined)
  }
}

export async function probeDuration(
  config: FtpServerConfig,
  remotePath: string
): Promise<number | undefined> {
  const headPath = await fetchHeadBytes(config, remotePath, 8 * 1024 * 1024)
  try {
    return await new Promise<number | undefined>((resolve) => {
      ffmpeg.ffprobe(headPath, (err, data) => {
        if (err) resolve(undefined)
        else resolve(data?.format?.duration)
      })
    })
  } finally {
    fs.unlink(headPath).catch(() => undefined)
  }
}
