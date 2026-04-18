/**
 * Per-server concurrency limiter for FTP/SFTP sessions.
 *
 * Many seedbox and anime FTP servers cap the number of simultaneous control
 * sessions a single user may open (often 1–2). When the app opens more than
 * that — e.g. a streaming session, a subtitle extraction, and a library scan
 * all at once — the server silently stalls or rejects the extras and the UI
 * appears to hang.
 *
 * Users can set `maxConcurrentConnections` on a server config; this module
 * hands out permits keyed by server id so only that many `connect()` calls
 * are in flight at a time. An unset/zero limit means unlimited (backwards
 * compatible behaviour).
 */

class Semaphore {
  private inUse = 0
  private waiters: Array<() => void> = []
  public max: number

  constructor(max: number) {
    this.max = max > 0 && Number.isFinite(max) ? max : Number.POSITIVE_INFINITY
  }

  setMax(max: number): void {
    this.max = max > 0 && Number.isFinite(max) ? max : Number.POSITIVE_INFINITY
    // If the cap was raised, wake any waiters we can now admit. We increment
    // `inUse` as we hand out each permit so the accounting matches acquire().
    while (this.inUse < this.max && this.waiters.length > 0) {
      this.inUse++
      const next = this.waiters.shift()!
      next()
    }
  }

  async acquire(): Promise<void> {
    if (this.inUse < this.max) {
      this.inUse++
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    // release() already incremented `inUse` on our behalf before waking us.
  }

  release(): void {
    const next = this.waiters.shift()
    if (next) {
      // Hand the permit straight to the waiter; inUse stays the same.
      next()
    } else {
      this.inUse--
    }
  }
}

const semaphores = new Map<string, Semaphore>()

function getSemaphore(serverId: string, max: number | undefined): Semaphore {
  const effective = typeof max === 'number' && max > 0 ? max : Number.POSITIVE_INFINITY
  let sem = semaphores.get(serverId)
  if (!sem) {
    sem = new Semaphore(effective)
    semaphores.set(serverId, sem)
  } else if (sem.max !== effective) {
    sem.setMax(effective)
  }
  return sem
}

export async function acquireConnection(
  serverId: string,
  max: number | undefined
): Promise<() => void> {
  const sem = getSemaphore(serverId, max)
  await sem.acquire()
  let released = false
  return () => {
    if (released) return
    released = true
    sem.release()
  }
}
