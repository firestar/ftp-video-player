import type { FtpServerConfig, RemoteEntry } from '@shared/types'
import type { Readable } from 'node:stream'

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
 */
export interface IFtpClient {
  connect(): Promise<void>
  disconnect(): Promise<void>
  list(path: string): Promise<RemoteEntry[]>
  size(path: string): Promise<number>
  downloadToFile(remotePath: string, localPath: string): Promise<void>
  createReadStream(remotePath: string, options?: RangeStreamOptions): Promise<Readable>
}

export async function createFtpClient(config: FtpServerConfig): Promise<IFtpClient> {
  if (config.protocol === 'sftp') {
    const { SftpClient } = await import('./sftp.js')
    return new SftpClient(config)
  }
  const { FtpClient } = await import('./ftp.js')
  return new FtpClient(config)
}
