import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AnimeEntry } from '@shared/types'
import { api } from '../api'
import { useFavorites } from '../favorites'
import { AnimeCard, VirtualGrid } from './Library'

export default function Favorites(): JSX.Element {
  const [entries, setEntries] = useState<AnimeEntry[]>([])
  const [hasLoaded, setHasLoaded] = useState(false)
  const { favorites, isFavorite, toggle } = useFavorites()
  const navigate = useNavigate()

  useEffect(() => {
    void (async () => {
      try {
        const cached = await api.cachedLibrary()
        setEntries(cached)
      } catch (err) {
        console.error(err)
      } finally {
        setHasLoaded(true)
      }
    })()
  }, [])

  const favoriteEntries = useMemo(() => {
    const keys = new Set(favorites.map((f) => `${f.serverId}::${f.path}`))
    const addedAtByKey = new Map(
      favorites.map((f) => [`${f.serverId}::${f.path}`, f.addedAt] as const)
    )
    return entries
      .filter((e) => keys.has(`${e.serverId}::${e.path}`))
      .sort((a, b) => {
        const at = addedAtByKey.get(`${a.serverId}::${a.path}`) ?? 0
        const bt = addedAtByKey.get(`${b.serverId}::${b.path}`) ?? 0
        return bt - at
      })
  }, [entries, favorites])

  if (!hasLoaded) {
    return (
      <div className="page">
        <div className="empty">Loading favorites…</div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Favorites</h1>
      </div>

      {favorites.length === 0 && (
        <div className="empty">
          No favorites yet. Hover an anime card in your{' '}
          <a onClick={() => navigate('/library')}>Library</a> and tap the star to
          save it here.
        </div>
      )}

      {favorites.length > 0 && favoriteEntries.length === 0 && (
        <div className="empty">
          Your favorites haven&apos;t been scanned yet. Open the{' '}
          <a onClick={() => navigate('/library')}>Library</a> to refresh.
        </div>
      )}

      {favoriteEntries.length > 0 && (
        <VirtualGrid
          items={favoriteEntries}
          getKey={(e) => e.id}
          renderItem={(entry) => (
            <AnimeCard
              entry={entry}
              isFavorite={isFavorite(entry)}
              onToggleFavorite={() => void toggle(entry)}
            />
          )}
        />
      )}
    </div>
  )
}
