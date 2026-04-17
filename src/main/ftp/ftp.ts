import * as basicFtp from 'basic-ftp'
import { PassThrough, Readable } from 'node:stream'
import { createWriteStream } from 'node:fs'
import type { FtpServerConfig, RemoteEntry } from '@shared/types'
import type { IFtpClient, RangeStreamOptions } from './client.js'

export class FtpClient implements IFtpClient {
  private client: basicFtp.Client
  private connected = false

  constructor(private readonly config: FtpServerConfig) {
    this.client = new basicFtp.Client(30_000)
    this.client.ftp.verbose = false
  }

  async connect(): Promise<void> {
    if (this.connected) return
    const { host, port, username, password, protocol, allowSelfSigned } = this.config
    const secure = protocol === 'ftps' ? true : this.config.secure ?? false
    await this.client.access({
      host,
      port: port || 21,
      user: username,
      password,
      secure,
      secureOptions: allowSelfSigned ? { rejectUnauthorized: false } : undefined
    })
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return
    this.client.close()
    this.connected = false
  }

  async list(path: string): Promise<RemoteEntry[]> {
    await this.connect()
    const items = await this.client.list(path)
    return items
      .filter((i) => i.name !== '.' && i.name !== '..')
      .map((i) => ({
        name: i.name,
        path: joinPath(path, i.name),
        type: i.isDirectory ? 'directory' : 'file',
        size: i.size,
        modifiedAt: i.modifiedAt ? i.modifiedAt.getTime() : undefined
      }))
  }

  async size(path: string): Promise<number> {
    await this.connect()
    return this.client.size(path)
  }

  async downloadToFile(remotePath: string, localPath: string): Promise<void> {
    await this.connect()
    await this.client.downloadTo(createWriteStream(localPath), remotePath)
  }

  async createReadStream(remotePath: string, options?: RangeStreamOptions): Promise<Readable> {
    await this.connect()
    const passthrough = new PassThrough()
    const start = options?.start ?? 0
    // basic-ftp supports REST via downloadTo(stream, path, startAt)
    // We do not get an explicit end; caller should slice the stream if needed.
    this.client
      .downloadTo(passthrough, remotePath, start)
      .then(() => passthrough.end())
      .catch((err) => passthrough.destroy(err))

    if (options?.end !== undefined) {
      const limit = options.end - start + 1
      return limitStream(passthrough, limit)
    }
    return passthrough
  }
}

function joinPath(dir: string, name: string): string {
  if (dir.endsWith('/')) return dir + name
  return dir + '/' + name
}

function limitStream(source: Readable, maxBytes: number): Readable {
  let remaining = maxBytes
  const out = new PassThrough()
  source.on('data', (chunk: Buffer) => {
    if (remaining <= 0) return
    if (chunk.length <= remaining) {
      remaining -= chunk.length
      out.write(chunk)
      if (remaining === 0) {
        out.end()
        source.destroy()
      }
    } else {
      out.write(chunk.subarray(0, remaining))
      remaining = 0
      out.end()
      source.destroy()
    }
  })
  source.on('end', () => out.end())
  source.on('error', (err) => out.destroy(err))
  return out
}
