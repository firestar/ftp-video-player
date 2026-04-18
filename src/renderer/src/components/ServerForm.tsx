import { useState } from 'react'
import type { FtpProtocol, FtpServerConfig } from '@shared/types'
import { api } from '../api'

interface Props {
  initial?: FtpServerConfig
  onClose(): void
  onSave(config: Omit<FtpServerConfig, 'id'> & { id?: string }): Promise<void> | void
}

const DEFAULT_PORTS: Record<FtpProtocol, number> = { ftp: 21, ftps: 990, sftp: 22 }

export default function ServerForm({ initial, onClose, onSave }: Props): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [protocol, setProtocol] = useState<FtpProtocol>(initial?.protocol ?? 'sftp')
  const [host, setHost] = useState(initial?.host ?? '')
  const [port, setPort] = useState<number>(initial?.port ?? DEFAULT_PORTS[initial?.protocol ?? 'sftp'])
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState(initial?.password ?? '')
  const [secure, setSecure] = useState<boolean>(initial?.secure ?? false)
  const [allowSelfSigned, setAllowSelfSigned] = useState<boolean>(initial?.allowSelfSigned ?? false)
  const [maxConcurrentConnections, setMaxConcurrentConnections] = useState<number>(
    initial?.maxConcurrentConnections ?? 0
  )
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function buildConfig(): Omit<FtpServerConfig, 'id'> & { id?: string } {
    const normalizedMax = Number.isFinite(maxConcurrentConnections)
      ? Math.max(0, Math.floor(maxConcurrentConnections))
      : 0
    return {
      id: initial?.id,
      name: name.trim() || `${username}@${host}`,
      protocol,
      host: host.trim(),
      port: Number(port) || DEFAULT_PORTS[protocol],
      username: username.trim(),
      password,
      secure,
      allowSelfSigned,
      maxConcurrentConnections: normalizedMax > 0 ? normalizedMax : undefined
    }
  }

  async function handleTest(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.testServer({ ...buildConfig(), id: initial?.id ?? 'test' })
      setTestResult(result.ok ? 'Connection OK' : `Failed: ${result.error ?? 'unknown'}`)
    } finally {
      setTesting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave(buildConfig())
    } finally {
      setSaving(false)
    }
  }

  function handleProtocolChange(next: FtpProtocol): void {
    setProtocol(next)
    setPort(DEFAULT_PORTS[next])
    if (next === 'ftps') setSecure(true)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{initial ? 'Edit server' : 'Add server'}</h2>
        <form className="form" onSubmit={handleSubmit}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My seedbox" />
          </label>

          <div className="form-row">
            <label>
              Protocol
              <select value={protocol} onChange={(e) => handleProtocolChange(e.target.value as FtpProtocol)}>
                <option value="sftp">SFTP (SSH)</option>
                <option value="ftp">FTP</option>
                <option value="ftps">FTPS (Implicit TLS)</option>
              </select>
            </label>
            <label>
              Port
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                min={1}
                max={65535}
              />
            </label>
          </div>

          <label>
            Host
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="example.com"
              required
            />
          </label>

          <div className="form-row">
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </div>

          <label>
            Max concurrent connections
            <input
              type="number"
              value={maxConcurrentConnections}
              onChange={(e) => setMaxConcurrentConnections(Number(e.target.value))}
              min={0}
              max={32}
              placeholder="0 = unlimited"
            />
            <span style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
              Cap the number of simultaneous FTP sessions against this server. Many seedbox / anime
              FTP servers allow only 1–2 at a time. Leave at 0 for unlimited.
            </span>
          </label>

          {protocol === 'ftp' && (
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
              Upgrade to TLS after connect (explicit FTPS)
            </label>
          )}

          {(protocol === 'ftps' || protocol === 'sftp' || (protocol === 'ftp' && secure)) && (
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={allowSelfSigned}
                onChange={(e) => setAllowSelfSigned(e.target.checked)}
              />
              Allow self-signed certificates
            </label>
          )}

          {testResult && (
            <div
              style={{
                fontSize: 12,
                color: testResult.startsWith('Connection OK') ? '#7ee787' : '#ff7b7b'
              }}
            >
              {testResult}
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="button secondary" onClick={handleTest} disabled={testing}>
              {testing ? 'Testing…' : 'Test'}
            </button>
            <button type="button" className="button ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
