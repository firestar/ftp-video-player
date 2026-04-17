import SftpClientLib from 'ssh2-sftp-client'
import { Readable } from 'node:stream'
import type { FtpServerConfig, RemoteEntry } from '@shared/types'
import type { IFtpClient, RangeStreamOptions } from './client.js'

// ssh2-sftp-client surfaces underlying socket failures with messages like
// these when the control channel drops mid-operation.
const TRANSIENT_SFTP_ERROR_PATTERNS = [
  /ECONNRESET/i,
  /socket hang up/i,
  /Not connected/i,
  /Connection lost/i,
  /closed by remote host/i,
  /ETIMEDOUT/i
]

function isTransientSftpError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return TRANSIENT_SFTP_ERROR_PATTERNS.some((re) => re.test(msg))
}

export class SftpClient implements IFtpClient {
  private client: SftpClientLib
  private connected = false

  constructor(private readonly config: FtpServerConfig) {
    this.client = new SftpClientLib()
  }

  async connect(): Promise<void> {
    if (this.connected) return
    const { host, port, username, password } = this.config
    await this.client.connect({
      host,
      port: port || 22,
      username,
      password,
      readyTimeout: 30_000
    })
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return
    try {
      await this.client.end()
    } catch {
      // ssh2-sftp-client throws if the socket is already torn down.
    }
    this.connected = false
  }

  private async reset(): Promise<void> {
    try {
      await this.client.end()
    } catch {
      // ignore — the socket is likely already gone.
    }
    this.connected = false
    this.client = new SftpClientLib()
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  private async withRetry<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op()
    } catch (err) {
      if (!isTransientSftpError(err)) throw err
      await this.reset()
      return op()
    }
  }

  async list(path: string): Promise<RemoteEntry[]> {
    return this.withRetry(async () => {
      await this.connect()
      const items = await this.client.list(path)
      return items.map((i) => ({
        name: i.name,
        path: joinPath(path, i.name),
        type: i.type === 'd' ? 'directory' : 'file',
        size: i.size,
        modifiedAt: typeof i.modifyTime === 'number' ? i.modifyTime : undefined
      }))
    })
  }

  async size(path: string): Promise<number> {
    return this.withRetry(async () => {
      await this.connect()
      const stat = await this.client.stat(path)
      return stat.size
    })
  }

  async downloadToFile(remotePath: string, localPath: string): Promise<void> {
    await this.connect()
    await this.client.fastGet(remotePath, localPath)
  }

  async createReadStream(remotePath: string, options?: RangeStreamOptions): Promise<Readable> {
    await this.connect()
    const start = options?.start ?? 0
    const end = options?.end
    const stream = this.client.createReadStream(remotePath, {
      start,
      end,
      autoClose: true
    }) as unknown as Readable
    return stream
  }
}

function joinPath(dir: string, name: string): string {
  if (dir.endsWith('/')) return dir + name
  return dir + '/' + name
}
