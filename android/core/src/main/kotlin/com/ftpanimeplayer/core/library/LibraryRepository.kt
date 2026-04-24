package com.ftpanimeplayer.core.library

import com.ftpanimeplayer.core.api.AnimeEntry
import com.ftpanimeplayer.core.api.ApiClient
import com.ftpanimeplayer.core.api.FavoriteFolder
import com.ftpanimeplayer.core.api.FtpServerConfig
import com.ftpanimeplayer.core.api.LibraryRoot
import com.ftpanimeplayer.core.api.VideoProgress
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * In-memory cache + StateFlow surface for UI. Stateful wrapper around
 * [ApiClient] — matches the `LibraryStore.swift` ObservableObject in Apple
 * Core.
 */
class LibraryRepository(private val api: ApiClient) {

    private val _servers = MutableStateFlow<List<FtpServerConfig>>(emptyList())
    val servers: StateFlow<List<FtpServerConfig>> = _servers.asStateFlow()

    private val _libraryRoots = MutableStateFlow<List<LibraryRoot>>(emptyList())
    val libraryRoots: StateFlow<List<LibraryRoot>> = _libraryRoots.asStateFlow()

    private val _library = MutableStateFlow<List<AnimeEntry>>(emptyList())
    val library: StateFlow<List<AnimeEntry>> = _library.asStateFlow()

    private val _favorites = MutableStateFlow<List<FavoriteFolder>>(emptyList())
    val favorites: StateFlow<List<FavoriteFolder>> = _favorites.asStateFlow()

    private val _progress = MutableStateFlow<List<VideoProgress>>(emptyList())
    val progress: StateFlow<List<VideoProgress>> = _progress.asStateFlow()

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError.asStateFlow()

    suspend fun refreshAll() {
        try {
            _servers.value = api.listServers()
            _libraryRoots.value = api.listLibraryRoots()
            _library.value = api.cachedLibrary()
            _favorites.value = api.listFavorites()
            _progress.value = api.listProgress()
            _lastError.value = null
        } catch (e: Exception) {
            _lastError.value = e.message
        }
    }

    suspend fun upsertServer(cfg: FtpServerConfig): FtpServerConfig {
        val saved = api.upsertServer(cfg)
        _servers.value = _servers.value.filter { it.id != saved.id } + saved
        return saved
    }

    suspend fun removeServer(id: String) {
        api.removeServer(id)
        _servers.value = _servers.value.filter { it.id != id }
    }

    suspend fun loadAnime(entry: AnimeEntry): AnimeEntry = api.loadAnime(
        serverId = entry.serverId,
        path = entry.path,
        libraryRootId = entry.libraryRootId
    )

    suspend fun setProgress(progress: VideoProgress) {
        try {
            api.setProgress(progress)
            _progress.value = (_progress.value.filter { it.path != progress.path || it.serverId != progress.serverId } + progress)
        } catch (_: Exception) {
            // swallow — best effort
        }
    }
}
