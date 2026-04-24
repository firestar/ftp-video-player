package com.ftpanimeplayer.mobile.ui

import android.view.ViewGroup
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.ftpanimeplayer.core.api.ApiClient
import com.ftpanimeplayer.core.api.ProbeResult
import com.ftpanimeplayer.core.api.RegisterStreamRequest
import com.ftpanimeplayer.core.api.VideoFile
import com.ftpanimeplayer.core.api.VideoProgress
import com.ftpanimeplayer.core.library.LibraryRepository
import com.ftpanimeplayer.core.stream.StreamResolver
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun PlayerScreen(
    api: ApiClient,
    repository: LibraryRepository,
    serverId: String,
    path: String,
    size: Long,
    onExit: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var streamUrl by remember { mutableStateOf<String?>(null) }
    var token by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(serverId, path) {
        try {
            val handle = api.registerStream(RegisterStreamRequest(serverId, path, size))
            token = handle.token
            val probe: ProbeResult = runCatching { api.probe(handle.token) }.getOrNull()
                ?: ProbeResult(directPlayable = false)
            val video = VideoFile(name = path.substringAfterLast('/'), path = path, size = size)
            streamUrl = api.playbackUrl(handle, preferDirect = StreamResolver.shouldDirectPlay(video, probe))
        } catch (e: Exception) {
            error = e.message
        }
    }

    DisposableEffect(token) {
        onDispose {
            val t = token ?: return@onDispose
            // Fire and forget; DisposableEffect disposal is synchronous, so we
            // spawn the cleanup on the still-alive coroutine scope.
            scope.launch { runCatching { api.unregisterStream(t) } }
        }
    }

    when {
        error != null -> {
            Box(Modifier.fillMaxSize()) {
                Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
            }
        }
        streamUrl == null -> {
            Box(Modifier.fillMaxSize()) { CircularProgressIndicator() }
        }
        else -> {
            PlayerSurface(
                streamUrl = streamUrl!!,
                serverId = serverId,
                path = path,
                size = size,
                repository = repository,
                onExit = onExit,
                context = context
            )
        }
    }
}

@Composable
private fun PlayerSurface(
    streamUrl: String,
    serverId: String,
    path: String,
    size: Long,
    repository: LibraryRepository,
    onExit: () -> Unit,
    context: android.content.Context
) {
    val exoPlayer = remember {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(streamUrl))
            prepare()
            playWhenReady = true
        }
    }

    LaunchedEffect(exoPlayer) {
        while (true) {
            delay(10_000)
            val positionMs = exoPlayer.currentPosition
            val durationMs = exoPlayer.duration.takeIf { it > 0 } ?: 0
            if (positionMs > 0) {
                repository.setProgress(
                    VideoProgress(
                        serverId = serverId,
                        path = path,
                        size = size,
                        positionSeconds = positionMs / 1000.0,
                        durationSeconds = durationMs / 1000.0,
                        updatedAt = System.currentTimeMillis(),
                        videoName = path.substringAfterLast('/'),
                        animeTitle = path.substringBeforeLast('/').substringAfterLast('/')
                    )
                )
            }
            if (exoPlayer.playbackState == Player.STATE_ENDED) break
        }
    }

    DisposableEffect(exoPlayer) { onDispose { exoPlayer.release() } }

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
