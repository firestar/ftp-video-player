export type FtpProtocol = 'ftp' | 'ftps' | 'sftp'

export interface FtpServerConfig {
  id: string
  name: string
  protocol: FtpProtocol
  host: string
  port: number
  username: string
  password: string
  /** For plain FTP: set true for implicit TLS / FTPS control channel. */
  secure?: boolean
  /** Allow self-signed certificates for FTPS/SFTP. */
  allowSelfSigned?: boolean
}

export interface LibraryRoot {
  id: string
  serverId: string
  path: string
  label?: string
}

export interface RemoteEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modifiedAt?: number
}

export interface VideoFile {
  name: string
  path: string
  size: number
  modifiedAt?: number
  thumbnailPath?: string
  durationSeconds?: number
}

export interface AnimeMetadata {
  malId?: number
  title: string
  englishTitle?: string
  japaneseTitle?: string
  synopsis?: string
  score?: number
  year?: number
  episodes?: number
  type?: string
  genres?: string[]
  imageUrl?: string
  posterPath?: string
}

export interface AnimeEntry {
  id: string
  serverId: string
  libraryRootId: string
  folderName: string
  path: string
  metadata?: AnimeMetadata
  videos: VideoFile[]
  lastScannedAt?: number
}

export interface FavoriteFolder {
  serverId: string
  libraryRootId: string
  path: string
  addedAt: number
}

export interface StreamRequest {
  serverId: string
  path: string
  size: number
}

export interface StreamHandle {
  token: string
  /** Raw byte-range stream URL (direct play when codec is browser-compatible). */
  directUrl: string
  /** On-the-fly transcoded fMP4 URL; accepts `?seek=<seconds>` and `?sub=<n>`. */
  transcodeUrl: string
  /** JSON probe endpoint: codecs, duration, subtitle list, directPlayable flag. */
  probeUrl: string
  /** Subtitle extractor base — append `/<streamIndex>` for a WebVTT track. */
  subtitleUrl: string
  /** @deprecated Alias of directUrl kept for older renderer code. */
  url: string
}

export interface SubtitleTrackInfo {
  index: number
  codec: string
  language?: string
  title?: string
  isDefault: boolean
}

export interface ProbeResult {
  container?: string
  duration?: number
  videoCodec?: string
  audioCodec?: string
  subtitles: SubtitleTrackInfo[]
  directPlayable: boolean
}

export interface ConnectionTestResult {
  ok: boolean
  error?: string
}

export interface VideoProgress {
  serverId: string
  path: string
  size: number
  positionSeconds: number
  durationSeconds: number
  updatedAt: number
  videoName: string
  animeTitle: string
  posterPath?: string
}

export type VideoExtension = '.mkv' | '.mp4' | '.avi' | '.mov' | '.webm' | '.m4v' | '.ts' | '.wmv' | '.flv'

export const VIDEO_EXTENSIONS: VideoExtension[] = [
  '.mkv',
  '.mp4',
  '.avi',
  '.mov',
  '.webm',
  '.m4v',
  '.ts',
  '.wmv',
  '.flv'
]

export function isVideoFile(name: string): boolean {
  const lower = name.toLowerCase()
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export interface Api {
  listServers(): Promise<FtpServerConfig[]>
  upsertServer(input: Omit<FtpServerConfig, 'id'> & { id?: string }): Promise<FtpServerConfig>
  removeServer(id: string): Promise<void>
  testServer(config: FtpServerConfig): Promise<ConnectionTestResult>
  browse(serverId: string, path: string): Promise<RemoteEntry[]>

  listLibraryRoots(): Promise<LibraryRoot[]>
  addLibraryRoot(input: Omit<LibraryRoot, 'id'>): Promise<LibraryRoot>
  removeLibraryRoot(id: string): Promise<void>

  scanLibrary(): Promise<void>
  cachedLibrary(): Promise<AnimeEntry[]>
  onLibraryItem(cb: (entry: AnimeEntry) => void): () => void
  onLibraryDone(cb: () => void): () => void
  loadAnime(serverId: string, path: string, libraryRootId: string): Promise<AnimeEntry | undefined>
  cachedAnime(
    serverId: string,
    path: string,
    libraryRootId: string
  ): Promise<AnimeEntry | undefined>

  searchAnime(query: string): Promise<AnimeMetadata[]>
  overrideMetadata(
    serverId: string,
    path: string,
    metadata: AnimeMetadata
  ): Promise<AnimeMetadata>
  refreshMetadata(
    serverId: string,
    path: string,
    folderName: string
  ): Promise<AnimeMetadata | undefined>

  generateThumbnail(
    serverId: string,
    remotePath: string,
    timestampSeconds?: number
  ): Promise<string | undefined>

  registerStream(serverId: string, remotePath: string, size: number): Promise<StreamHandle>
  unregisterStream(token: string): Promise<void>

  getVideoProgress(serverId: string, remotePath: string): Promise<VideoProgress | undefined>
  setVideoProgress(progress: VideoProgress): void
  listUnfinishedVideos(): Promise<VideoProgress[]>
  listVideoProgress(): Promise<VideoProgress[]>

  listFavoriteFolders(): Promise<FavoriteFolder[]>
  addFavoriteFolder(input: FavoriteFolder): Promise<FavoriteFolder[]>
  removeFavoriteFolder(serverId: string, path: string): Promise<FavoriteFolder[]>
}
