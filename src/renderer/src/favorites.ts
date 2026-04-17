import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AnimeEntry, FavoriteFolder } from '@shared/types'
import { api } from './api'

function favKey(serverId: string, path: string): string {
  return `${serverId}::${path}`
}

export function useFavorites(): {
  favorites: FavoriteFolder[]
  favoriteKeys: Set<string>
  isFavorite: (entry: Pick<AnimeEntry, 'serverId' | 'path'>) => boolean
  toggle: (entry: AnimeEntry) => Promise<void>
} {
  const [favorites, setFavorites] = useState<FavoriteFolder[]>([])

  useEffect(() => {
    void api
      .listFavoriteFolders()
      .then(setFavorites)
      .catch((err) => console.error(err))
  }, [])

  const favoriteKeys = useMemo(
    () => new Set(favorites.map((f) => favKey(f.serverId, f.path))),
    [favorites]
  )

  const isFavorite = useCallback(
    (entry: Pick<AnimeEntry, 'serverId' | 'path'>) =>
      favoriteKeys.has(favKey(entry.serverId, entry.path)),
    [favoriteKeys]
  )

  const toggle = useCallback(
    async (entry: AnimeEntry): Promise<void> => {
      const key = favKey(entry.serverId, entry.path)
      if (favoriteKeys.has(key)) {
        const next = await api.removeFavoriteFolder(entry.serverId, entry.path)
        setFavorites(next)
      } else {
        const next = await api.addFavoriteFolder({
          serverId: entry.serverId,
          libraryRootId: entry.libraryRootId,
          path: entry.path,
          addedAt: Date.now()
        })
        setFavorites(next)
      }
    },
    [favoriteKeys]
  )

  return { favorites, favoriteKeys, isFavorite, toggle }
}
