import type { Api } from '@shared/types'

declare global {
  interface Window {
    api: Api
  }
}

export const api: Api = window.api

/** Convert a local filesystem path (for a poster or thumbnail) into a url
 *  that can be used as an <img src>. The main process registers a custom
 *  `local://` protocol that reads the file. */
export function localFileUrl(absolutePath: string | undefined): string | undefined {
  if (!absolutePath) return undefined
  return `local://host${absolutePath.startsWith('/') ? '' : '/'}${absolutePath}`
}
