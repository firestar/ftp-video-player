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
  // Many modern FTP servers reject unencrypted control sessions and close the
  // socket as soon as a data command is issued. When that happens we fall back
  // to AUTH TLS on the same port (explicit FTPS) for the remainder of the
  // session, even if the user configured plain FTP.
  private secureOverride: boolean | null = null
  // Ring buffer of the most recent control-channel commands and replies for
  // the current attempt. Surfacing the tail in error messages turns opaque FIN
  // failures into something a user can act on (e.g. "FIN right after MLSD").
  private sessionLog: string[] = []
  private static readonly SESSION_LOG_MAX = 24

  constructor(private readonly config: FtpServerConfig) {
    this.client = this.buildClient()
  }

  private buildClient(): basicFtp.Client {
    const client = new basicFtp.Client(30_000)
    if (this.listCommandOverride) {
      client.availableListCommands = this.listCommandOverride
    }
    // basic-ftp's verbose flag writes directly to console.log; we instead
    // hijack the log() hook to capture into a ring buffer and silence stdout.
    client.ftp.verbose = true
    client.ftp.log = (msg: string): void => {
      this.sessionLog.push(redactCredentials(msg))
      if (this.sessionLog.length > FtpClient.SESSION_LOG_MAX) {
        this.sessionLog.shift()
      }
    }
    return client
  }

  private resolveSecure(): boolean {
    if (this.secureOverride !== null) return this.secureOverride
    if (this.config.protocol === 'ftps') return true
    return this.config.secure ?? false
  }

  private async doConnect(): Promise<void> {
    const { host, port, username, password, allowSelfSigned } = this.config
    const secure = this.resolveSecure()
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

  private async reset(opts: { skipMlsd?: boolean; upgradeTls?: boolean } = {}): Promise<void> {
    try {
      this.client.close()
    } catch {
      // ignore
    }
    this.connected = false
    this.sessionLog = []
    if (opts.skipMlsd) this.listCommandOverride = ['LIST']
    if (opts.upgradeTls) this.secureOverride = true
    this.client = this.buildClient()
  }

  private failureMessage(err: unknown, hint: string): string {
    const base = err instanceof Error ? err.message : String(err)
    const tail = this.sessionLog.slice(-8).join(' | ')
    const trail = tail ? ` Last control exchange: ${tail}.` : ''
    return `${base} — ${hint}${trail}`
  }

  private async withRetry<T>(op: () => Promise<T>): Promise<T> {
    try {
      this.sessionLog = []
      return await op()
    } catch (err) {
      if (!isTransientFtpError(err)) throw err
      // First fallback: rebuild the client and avoid MLSD, which is a common
      // culprit on older servers that advertise it but bail when it's issued.
      await this.reset({ skipMlsd: true })
      try {
        return await op()
      } catch (err2) {
        if (!isTransientFtpError(err2)) throw err2
        // Second fallback: many modern FTP servers refuse to serve plain
        // sessions and drop the socket. If the user configured plain FTP,
        // transparently upgrade to AUTH TLS on the same port and retry.
        if (this.resolveSecure()) {
          throw new Error(
            this.failureMessage(
              err2,
              'the FTP server dropped the connection even with TLS enabled. ' +
                'If the server uses a self-signed certificate, enable "Allow self-signed certificates". ' +
                'Otherwise the server may require SFTP.'
            )
          )
        }
        await this.reset({ skipMlsd: true, upgradeTls: true })
        try {
          return await op()
        } catch (err3) {
          throw new Error(
            this.failureMessage(
              err3,
              'the FTP server dropped the connection, and upgrading to TLS (AUTH TLS) also failed. ' +
                'Try enabling "Upgrade to TLS after connect" in the server settings, or use SFTP.'
            )
          )
        }
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

function redactCredentials(message: string): string {
  // basic-ftp logs commands as "> PASS hunter2"; never let that reach a UI.
  return message.replace(/(>\s*PASS)\s+\S+/gi, '$1 ***')
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
