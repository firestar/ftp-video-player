import type { FtpServerConfig, RemoteEntry } from '@shared/types'
import type { Readable } from 'node:stream'
import { acquireConnection } from './pool.js'

export interface RangeStreamOptions {
  start: number
  end?: number
}

/**
 * A unified client interface abstracting FTP, FTPS, and SFTP.
 *
 * Connections are cheap to open but not free — callers should reuse an open
 * session when possible. For streaming video the main process spins up a
 * dedicated client per active stream so range requests don't interfere.
 *
 * The client returned by `createFtpClient` is wrapped in a per-server
 * concurrency limiter (see `pool.ts`). `connect()` waits until a permit is
 * available and `disconnect()` releases it, so the app never exceeds the
 * server's configured `maxConcurrentConnections`.
 */
export interface IFtpClient {
  connect(): Promise<void>
  disconnect(): Promise<void>
  list(path: string): Promise<RemoteEntry[]>
  size(path: string): Promise<number>
  downloadToFile(remotePath: string, localPath: string): Promise<void>
  createReadStream(remotePath: string, options?: RangeStreamOptions): Promise<Readable>
}

async function createRawClient(config: FtpServerConfig): Promise<IFtpClient> {
  if (config.protocol === 'sftp') {
    const { SftpClient } = await import('./sftp.js')
    return new SftpClient(config)
  }
  const { FtpClient } = await import('./ftp.js')
  return new FtpClient(config)
}

/**
 * Wraps a raw client so that `connect()` reserves a concurrency permit and
 * `disconnect()` always releases it (even if connect failed partway). The
 * rest of the methods are pass-through.
 */
class PooledFtpClient implements IFtpClient {
  private inner: IFtpClient
  private serverId: string
  private max: number | undefined
  private release: (() => void) | null = null

  constructor(inner: IFtpClient, serverId: string, max: number | undefined) {
    this.inner = inner
    this.serverId = serverId
    this.max = max
  }

  async connect(): Promise<void> {
    if (this.release) return
    this.release = await acquireConnection(this.serverId, this.max)
    try {
      await this.inner.connect()
    } catch (err) {
      this.release?.()
      this.release = null
      throw err
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.inner.disconnect()
    } finally {
      this.release?.()
      this.release = null
    }
  }

  list(path: string): Promise<RemoteEntry[]> {
    return this.inner.list(path)
  }

  size(path: string): Promise<number> {
    return this.inner.size(path)
  }

  downloadToFile(remotePath: string, localPath: string): Promise<void> {
    return this.inner.downloadToFile(remotePath, localPath)
  }

  createReadStream(remotePath: string, options?: RangeStreamOptions): Promise<Readable> {
    return this.inner.createReadStream(remotePath, options)
  }
}

export async function createFtpClient(config: FtpServerConfig): Promise<IFtpClient> {
  const inner = await createRawClient(config)
  return new PooledFtpClient(inner, config.id, config.maxConcurrentConnections)
}
