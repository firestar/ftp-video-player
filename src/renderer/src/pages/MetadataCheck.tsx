import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MetadataMismatch } from '@shared/types'
import { api, localFileUrl } from '../api'

const REASON_LABEL: Record<MetadataMismatch['reason'], string> = {
  missing: 'No metadata assigned',
  'no-overlap': 'Title shares no words with the folder',
  'low-overlap': 'Title barely overlaps with the folder'
}

export default function MetadataCheck(): JSX.Element {
  const [mismatches, setMismatches] = useState<MetadataMismatch[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const scan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await api.scanMetadataMismatches()
      setMismatches(list)
    } catch (err) {
      setError((err as Error).message ?? 'Scan failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void scan()
  }, [scan])

  function openAnime(m: MetadataMismatch): void {
    const q = new URLSearchParams({ path: m.path })
    navigate(
      `/anime/${encodeURIComponent(m.serverId)}/${encodeURIComponent(m.libraryRootId)}?${q.toString()}`
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Metadata check</h1>
        <button className="button secondary" onClick={scan} disabled={loading}>
          {loading ? 'Scanning…' : 'Rescan'}
        </button>
      </div>

      <p style={{ color: 'var(--text-dim)', marginTop: -10, marginBottom: 18, fontSize: 13 }}>
        Flags folders whose assigned MyAnimeList title does not match the folder name. Open an
        entry to search again or override the metadata.
      </p>

      {error && <div className="empty">Error: {error}</div>}

      {!error && mismatches && mismatches.length === 0 && !loading && (
        <div className="empty">All cached folders match their metadata.</div>
      )}

      {mismatches && mismatches.length > 0 && (
        <div className="mismatch-list">
          {mismatches.map((m) => (
            <MismatchRow key={m.entryId} mismatch={m} onOpen={() => openAnime(m)} />
          ))}
        </div>
      )}
    </div>
  )
}

function MismatchRow({
  mismatch,
  onOpen
}: {
  mismatch: MetadataMismatch
  onOpen: () => void
}): JSX.Element {
  const poster = localFileUrl(mismatch.posterPath)
  const altTitles = [mismatch.metadataEnglishTitle, mismatch.metadataJapaneseTitle]
    .filter((t): t is string => !!t && t !== mismatch.metadataTitle)
    .join(' · ')
  return (
    <div className="mismatch-row" onClick={onOpen} role="button" tabIndex={0}>
      <div
        className="mismatch-poster"
        style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
      >
        {!poster && <span>🎬</span>}
      </div>
      <div className="mismatch-body">
        <div className="mismatch-folder" title={mismatch.path}>
          {mismatch.folderName}
        </div>
        <div className="mismatch-title">
          Title: <span>{mismatch.metadataTitle || '—'}</span>
        </div>
        {altTitles && <div className="mismatch-alt">{altTitles}</div>}
        <div className="mismatch-meta">
          <span className="pill">{REASON_LABEL[mismatch.reason]}</span>
          <span className="pill">match {Math.round(mismatch.score * 100)}%</span>
        </div>
      </div>
      <button
        className="button secondary"
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
      >
        Review
      </button>
    </div>
  )
}
