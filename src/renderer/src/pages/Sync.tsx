import { useEffect, useState } from 'react'
import type { SyncConfig, SyncResult, SyncStatus } from '@shared/types'
import { api } from '../api'

type Busy = null | 'test' | 'save' | 'push' | 'pull' | 'clear'

function formatTimestamp(ms?: number): string {
  if (!ms) return 'never'
  return new Date(ms).toLocaleString()
}

export default function Sync(): JSX.Element {
  const [baseUrl, setBaseUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [stored, setStored] = useState<SyncConfig | undefined>(undefined)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    const current = await api.getSyncConfig()
    setStored(current)
    if (current) {
      setBaseUrl(current.baseUrl)
      setUsername(current.username)
      setPassword(current.password)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  function buildConfig(): SyncConfig {
    return { baseUrl: baseUrl.trim(), username: username.trim(), password }
  }

  async function handleTest(): Promise<void> {
    setBusy('test')
    setError(null)
    setResult(null)
    try {
      const s = await api.testSync(buildConfig())
      setStatus(s)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function handleSave(): Promise<void> {
    setBusy('save')
    setError(null)
    try {
      const saved = await api.setSyncConfig(buildConfig())
      setStored(saved)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function handleClear(): Promise<void> {
    if (!window.confirm('Forget the sync server credentials stored on this device?')) return
    setBusy('clear')
    setError(null)
    try {
      await api.clearSyncConfig()
      setStored(undefined)
      setBaseUrl('')
      setUsername('')
      setPassword('')
      setStatus(null)
      setResult(null)
    } finally {
      setBusy(null)
    }
  }

  async function handlePush(): Promise<void> {
    setBusy('push')
    setError(null)
    setResult(null)
    try {
      const r = await api.pushSync()
      setResult(r)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function handlePull(): Promise<void> {
    if (
      !window.confirm(
        'Pull will overwrite the local database and cache with the server copy. Continue?'
      )
    ) {
      return
    }
    setBusy('pull')
    setError(null)
    setResult(null)
    try {
      const r = await api.pullSync()
      setResult(r)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const configured = Boolean(stored)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Sync</h1>
      </div>

      <p className="empty" style={{ textAlign: 'left' }}>
        Point the app at a running sync server (see <code>server/README.md</code>) to back up
        your library database and poster/thumbnail caches. Pushing uploads the local copy;
        pulling overwrites local data with what&apos;s on the server.
      </p>

      <form
        className="server-form"
        onSubmit={(e) => {
          e.preventDefault()
          void handleSave()
        }}
      >
        <label>
          <span>Server URL</span>
          <input
            type="url"
            value={baseUrl}
            placeholder="https://sync.example.com"
            onChange={(e) => setBaseUrl(e.target.value)}
            required
          />
        </label>
        <label>
          <span>Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <div className="form-actions">
          <button
            type="button"
            className="button"
            onClick={() => void handleTest()}
            disabled={busy !== null}
          >
            {busy === 'test' ? 'Testing…' : 'Test'}
          </button>
          <button type="submit" className="button primary" disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          {configured && (
            <button
              type="button"
              className="button"
              onClick={() => void handleClear()}
              disabled={busy !== null}
            >
              Forget
            </button>
          )}
        </div>
      </form>

      {status && (
        <div className="empty" style={{ textAlign: 'left' }}>
          <strong>{status.ok ? 'Connected.' : 'Connection failed.'}</strong> {status.message}
          {status.ok && (
            <ul style={{ marginTop: 8 }}>
              <li>
                Remote DB:{' '}
                {status.remoteDbExists
                  ? `${status.remoteDbSize ?? 0} bytes, modified ${formatTimestamp(status.remoteDbLastModifiedMs)}`
                  : 'not yet uploaded'}
              </li>
              <li>Remote posters: {status.remotePosterCount ?? 0}</li>
              <li>Remote thumbnails: {status.remoteThumbnailCount ?? 0}</li>
            </ul>
          )}
        </div>
      )}

      {configured && (
        <div className="page-header" style={{ marginTop: 24 }}>
          <h2>Sync actions</h2>
        </div>
      )}

      {configured && (
        <div className="form-actions">
          <button
            type="button"
            className="button primary"
            onClick={() => void handlePush()}
            disabled={busy !== null}
          >
            {busy === 'push' ? 'Pushing…' : 'Push to server'}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => void handlePull()}
            disabled={busy !== null}
          >
            {busy === 'pull' ? 'Pulling…' : 'Pull from server'}
          </button>
        </div>
      )}

      {configured && (
        <div className="empty" style={{ textAlign: 'left', marginTop: 12 }}>
          Last pushed: {formatTimestamp(stored?.lastPushedAt)}
          <br />
          Last pulled: {formatTimestamp(stored?.lastPulledAt)}
        </div>
      )}

      {result && (
        <div className="empty" style={{ textAlign: 'left' }}>
          <strong>{result.ok ? 'Success.' : 'Completed with errors.'}</strong> {result.message}
          {result.errors && result.errors.length > 0 && (
            <ul style={{ marginTop: 8 }}>
              {result.errors.slice(0, 10).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div className="empty" style={{ textAlign: 'left', color: '#ff6b6b' }}>
          {error}
        </div>
      )}
    </div>
  )
}
