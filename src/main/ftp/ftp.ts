import * as basicFtp from 'basic-ftp'
import { PassThrough, Readable } from 'node:stream'
import { createWriteStream } from 'node:fs'
import type { FtpServerConfig, RemoteEntry } from '@shared/types'
import type { IFtpClient, RangeStreamOptions } from './client.js'

// basic-ftp raises this when the control socket receives an unexpected FIN.
// The client instance is unusable afterwards — we must recreate it and retry.
const TRANSIENT_ERROR_PATTERNS = [
  /FIN packet/i,
  /socket hang up/i,
  /ECONNRESET/i,
  /Client is closed/i
]

function isTransientFtpError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return TRANSIENT_ERROR_PATTERNS.some((re) => re.test(msg))
}

export class FtpClient implements IFtpClient {
  private client: basicFtp.Client
  private connected = false
  // Some servers advertise MLSD via FEAT but drop the control connection when
  // it's issued. After the first FIN we skip MLSD and stick to plain LIST.
  private listCommandOverride: string[] | null = null

  constructor(private readonly config: FtpServerConfig) {
    this.client = this.buildClient()
  }

  private buildClient(): basicFtp.Client {
    const client = new basicFtp.Client(30_000)
    client.ftp.verbose = false
    if (this.listCommandOverride) {
      client.availableListCommands = this.listCommandOverride
    }
    return client
  }

  private async doConnect(): Promise<void> {
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

  async connect(): Promise<void> {
    if (this.connected) return
    await this.doConnect()
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return
    try {
      this.client.close()
    } catch {
      // basic-ftp can throw if the socket is already torn down — ignore.
    }
    this.connected = false
  }

  private async reset(skipMlsd: boolean): Promise<void> {
    try {
      this.client.close()
    } catch {
      // ignore
    }
    this.connected = false
    if (skipMlsd) this.listCommandOverride = ['LIST']
    this.client = this.buildClient()
  }

  private async withRetry<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op()
    } catch (err) {
      if (!isTransientFtpError(err)) throw err
      // Control connection was dropped — rebuild the client and try once more,
      // this time avoiding MLSD which is a common culprit on older servers.
      await this.reset(true)
      try {
        return await op()
      } catch (err2) {
        throw new Error(
          `${(err2 as Error).message} — the FTP server dropped the connection. ` +
            `Try enabling "Upgrade to TLS after connect" in the server settings, or use SFTP.`
        )
      }
    }
  }

  async list(path: string): Promise<RemoteEntry[]> {
    return this.withRetry(async () => {
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
    })
  }

  async size(path: string): Promise<number> {
    return this.withRetry(async () => {
      await this.connect()
      return this.client.size(path)
    })
  }

  async downloadToFile(remotePath: string, localPath: string): Promise<void> {
    return this.withRetry(async () => {
      await this.connect()
      await this.client.downloadTo(createWriteStream(localPath), remotePath)
    })
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
