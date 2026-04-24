package com.ftpanimeplayer.tv.ui

import android.view.ViewGroup
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import com.ftpanimeplayer.core.api.AnimeEntry
import com.ftpanimeplayer.core.api.ApiClient
import com.ftpanimeplayer.core.api.ProbeResult
import com.ftpanimeplayer.core.api.RegisterStreamRequest
import com.ftpanimeplayer.core.api.VideoFile
import com.ftpanimeplayer.core.api.VideoProgress
import com.ftpanimeplayer.core.library.LibraryRepository
import com.ftpanimeplayer.core.stream.StreamResolver
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun TvPlayerScreen(
    api: ApiClient,
    repository: LibraryRepository,
    entry: AnimeEntry,
    video: VideoFile,
    onExit: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var streamUrl by remember { mutableStateOf<String?>(null) }
    var token by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(video.path) {
        try {
            val handle = api.registerStream(RegisterStreamRequest(entry.serverId, video.path, video.size))
            token = handle.token
            val probe: ProbeResult = runCatching { api.probe(handle.token) }.getOrNull()
                ?: ProbeResult(directPlayable = false)
            streamUrl = api.playbackUrl(handle, preferDirect = StreamResolver.shouldDirectPlay(video, probe))
        } catch (e: Exception) {
            error = e.message
        }
    }

    DisposableEffect(token) {
        onDispose {
            val t = token ?: return@onDispose
            scope.launch { runCatching { api.unregisterStream(t) } }
        }
    }

    Box(Modifier.fillMaxSize()) {
        when {
            error != null -> Text(error.orEmpty())
            streamUrl == null -> CircularProgressIndicator()
            else -> {
                val exoPlayer = remember {
                    ExoPlayer.Builder(context).build().apply {
                        setMediaItem(MediaItem.fromUri(streamUrl!!))
                        prepare()
                        playWhenReady = true
                    }
                }
                DisposableEffect(exoPlayer) { onDispose { exoPlayer.release() } }
                LaunchedEffect(exoPlayer) {
                    while (true) {
                        delay(10_000)
                        val position = exoPlayer.currentPosition
                        val duration = exoPlayer.duration.takeIf { it > 0 } ?: 0
                        if (position > 0) {
                            repository.setProgress(
                                VideoProgress(
                                    serverId = entry.serverId,
                                    path = video.path,
                                    size = video.size,
                                    positionSeconds = position / 1000.0,
                                    durationSeconds = duration / 1000.0,
                                    updatedAt = System.currentTimeMillis(),
                                    videoName = video.name,
                                    animeTitle = entry.metadata?.title ?: entry.folderName,
                                    posterPath = entry.metadata?.posterPath
                                )
                            )
                        }
                        if (exoPlayer.playbackState == Player.STATE_ENDED) {
                            onExit(); break
                        }
                    }
                }
                AndroidView(
                    factory = { ctx ->
                        PlayerView(ctx).apply {
                            player = exoPlayer
                            layoutParams = ViewGroup.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )
                            useController = true
                        }
                    },
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
    }
}
