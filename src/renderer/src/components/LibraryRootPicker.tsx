import { useEffect, useState } from 'react'
import type { FtpServerConfig, RemoteEntry } from '@shared/types'
import { api } from '../api'

interface Props {
  server: FtpServerConfig
  onClose(): void
  onPick(path: string): Promise<void> | void
}

function parentPath(path: string): string {
  if (path === '/' || path === '') return '/'
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const idx = trimmed.lastIndexOf('/')
  if (idx <= 0) return '/'
  return trimmed.slice(0, idx) || '/'
}

function crumbs(path: string): Array<{ name: string; path: string }> {
  if (path === '/' || path === '') return [{ name: '/', path: '/' }]
  const parts = path.split('/').filter(Boolean)
  const out = [{ name: '/', path: '/' }]
  let cur = ''
  for (const part of parts) {
    cur += `/${part}`
    out.push({ name: part, path: cur })
  }
  return out
}

export default function LibraryRootPicker({ server, onClose, onPick }: Props): JSX.Element {
  const [cwd, setCwd] = useState('/')
  const [items, setItems] = useState<RemoteEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load(path: string): Promise<void> {
    setItems(null)
    setError(null)
    try {
      const entries = await api.browse(server.id, path)
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setItems(entries)
    } catch (err) {
      setError((err as Error).message)
      setItems([])
    }
  }

  useEffect(() => {
    void load(cwd)
  }, [cwd])

  async function handlePick(): Promise<void> {
    setBusy(true)
    try {
      await onPick(cwd)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Pick library folder on {server.name}</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: '0 0 8px' }}>
          Navigate to a folder that directly contains anime sub-folders (e.g. <code>/Anime/Movies</code>).
          The app lists each sub-folder as an anime.
        </p>
        <div className="breadcrumb">
          {crumbs(cwd).map((c, i, arr) => (
            <span key={c.path}>
              <a onClick={() => setCwd(c.path)}>{c.name}</a>
              {i < arr.length - 1 && <span>›</span>}
            </span>
          ))}
        </div>

        <div className="browser">
          {cwd !== '/' && (
            <div className="browser-item dir" onClick={() => setCwd(parentPath(cwd))}>
              📁 ..
            </div>
          )}
          {items === null && <div className="browser-item">Loading…</div>}
          {items && items.length === 0 && !error && (
            <div className="browser-item">Empty folder.</div>
          )}
          {error && <div className="browser-item" style={{ color: '#ff7b7b' }}>{error}</div>}
          {items?.map((item) => (
            <div
              key={item.path}
              className={`browser-item ${item.type}`}
              onClick={() => item.type === 'directory' && setCwd(item.path)}
              style={item.type === 'file' ? { cursor: 'default' } : undefined}
            >
              {item.type === 'directory' ? '📁' : '🎞'} {item.name}
            </div>
          ))}
        </div>

        <div className="form-actions">
          <span style={{ marginRight: 'auto', color: 'var(--text-dim)', fontSize: 12 }}>
            Current: <code>{cwd}</code>
          </span>
          <button className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button" onClick={handlePick} disabled={busy}>
            Use this folder
          </button>
        </div>
      </div>
    </div>
  )
}
