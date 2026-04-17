import { useEffect, useState } from 'react'
import type { FtpServerConfig, LibraryRoot } from '@shared/types'
import { api } from '../api'
import ServerForm from '../components/ServerForm'
import LibraryRootPicker from '../components/LibraryRootPicker'

export default function Servers(): JSX.Element {
  const [servers, setServers] = useState<FtpServerConfig[]>([])
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [editing, setEditing] = useState<FtpServerConfig | 'new' | null>(null)
  const [pickingFor, setPickingFor] = useState<FtpServerConfig | null>(null)

  async function refresh(): Promise<void> {
    const [s, r] = await Promise.all([api.listServers(), api.listLibraryRoots()])
    setServers(s)
    setRoots(r)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleSave(config: Omit<FtpServerConfig, 'id'> & { id?: string }): Promise<void> {
    await api.upsertServer(config)
    setEditing(null)
    await refresh()
  }

  async function handleDelete(server: FtpServerConfig): Promise<void> {
    if (!window.confirm(`Remove server "${server.name}" and its library roots?`)) return
    await api.removeServer(server.id)
    await refresh()
  }

  async function handleAddRoot(serverId: string, path: string): Promise<void> {
    await api.addLibraryRoot({ serverId, path })
    setPickingFor(null)
    await refresh()
  }

  async function handleRemoveRoot(id: string): Promise<void> {
    await api.removeLibraryRoot(id)
    await refresh()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Servers</h1>
        <button className="button" onClick={() => setEditing('new')}>
          Add server
        </button>
      </div>

      {servers.length === 0 && (
        <div className="empty">No servers yet. Add your first FTP / SFTP / FTPS server.</div>
      )}

      <div className="server-list">
        {servers.map((server) => {
          const serverRoots = roots.filter((r) => r.serverId === server.id)
          return (
            <div key={server.id} className="server-row" style={{ display: 'block' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{server.name}</div>
                  <div className="meta">
                    {server.protocol.toUpperCase()} · {server.username}@{server.host}:{server.port}
                  </div>
                </div>
                <div className="actions">
                  <button className="button ghost" onClick={() => setPickingFor(server)}>
                    Add folder
                  </button>
                  <button className="button ghost" onClick={() => setEditing(server)}>
                    Edit
                  </button>
                  <button className="button ghost" onClick={() => handleDelete(server)}>
                    Remove
                  </button>
                </div>
              </div>
              {serverRoots.length > 0 && (
                <div className="root-list">
                  {serverRoots.map((root) => (
                    <div key={root.id} className="root-row">
                      <span className="path">{root.path}</span>
                      <button className="button ghost" onClick={() => handleRemoveRoot(root.id)}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {editing && (
        <ServerForm
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {pickingFor && (
        <LibraryRootPicker
          server={pickingFor}
          onClose={() => setPickingFor(null)}
          onPick={(path) => handleAddRoot(pickingFor.id, path)}
        />
      )}
    </div>
  )
}
