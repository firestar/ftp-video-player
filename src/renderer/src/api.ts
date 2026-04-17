import type { Api } from '@shared/types'

declare global {
  interface Window {
    api: Api
  }
}

export const api: Api = window.api

/** Convert a local filesystem path (for a poster or thumbnail) into a url
 *  that can be used as an <img src>. The main process registers a custom
 *  `local://` protocol that reads the file.
 *
 *  Path segments are URL-encoded so that spaces and other reserved characters
 *  survive the round-trip — macOS userData lives under
 *  `~/Library/Application Support/...` which would otherwise split the URL. */
export function localFileUrl(absolutePath: string | undefined): string | undefined {
  if (!absolutePath) return undefined
  const normalized = absolutePath.startsWith('/') ? absolutePath : `/${absolutePath}`
  const encoded = normalized.split('/').map(encodeURIComponent).join('/')
  return `local://host${encoded}`
}
