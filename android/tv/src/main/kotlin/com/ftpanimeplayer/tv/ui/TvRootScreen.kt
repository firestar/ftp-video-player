package com.ftpanimeplayer.tv.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import com.ftpanimeplayer.core.api.AnimeEntry
import com.ftpanimeplayer.core.api.ApiClient
import com.ftpanimeplayer.core.api.VideoFile
import com.ftpanimeplayer.core.library.LibraryRepository

/**
 * Very small hand-rolled navigation for the TV app — Compose-for-TV's own
 * navigation story is still evolving, and three screens fits fine in state.
 */
@Composable
fun TvRootScreen(repository: LibraryRepository, api: ApiClient) {
    var destination by remember { mutableStateOf<TvDestination>(TvDestination.Library) }
    when (val dest = destination) {
        TvDestination.Library -> TvLibraryScreen(
            repository = repository,
            api = api,
            onEntry = { destination = TvDestination.Detail(it) }
        )
        is TvDestination.Detail -> TvAnimeDetailScreen(
            entry = dest.entry,
            api = api,
            onPlay = { entry, video -> destination = TvDestination.Player(entry, video) },
            onBack = { destination = TvDestination.Library }
        )
        is TvDestination.Player -> TvPlayerScreen(
            api = api,
            repository = repository,
            entry = dest.entry,
            video = dest.video,
            onExit = { destination = TvDestination.Detail(dest.entry) }
        )
    }
}

sealed class TvDestination {
    data object Library : TvDestination()
    data class Detail(val entry: AnimeEntry) : TvDestination()
    data class Player(val entry: AnimeEntry, val video: VideoFile) : TvDestination()
}
