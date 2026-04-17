import SftpClientLib from 'ssh2-sftp-client'
import { Readable } from 'node:stream'
import type { FtpServerConfig, RemoteEntry } from '@shared/types'
import type { IFtpClient, RangeStreamOptions } from './client.js'

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
    await this.client.end()
    this.connected = false
  }

  async list(path: string): Promise<RemoteEntry[]> {
    await this.connect()
    const items = await this.client.list(path)
    return items.map((i) => ({
      name: i.name,
      path: joinPath(path, i.name),
      type: i.type === 'd' ? 'directory' : 'file',
      size: i.size,
      modifiedAt: typeof i.modifyTime === 'number' ? i.modifyTime : undefined
    }))
  }

  async size(path: string): Promise<number> {
    await this.connect()
    const stat = await this.client.stat(path)
    return stat.size
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
