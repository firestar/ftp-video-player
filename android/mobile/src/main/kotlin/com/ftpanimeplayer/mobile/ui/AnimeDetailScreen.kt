package com.ftpanimeplayer.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.ftpanimeplayer.core.api.AnimeEntry
import com.ftpanimeplayer.core.api.ApiClient
import com.ftpanimeplayer.core.api.VideoFile
import com.ftpanimeplayer.core.library.LibraryRepository

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnimeDetailScreen(
    repository: LibraryRepository,
    api: ApiClient,
    serverId: String,
    libraryRootId: String,
    path: String,
    onPlay: (AnimeEntry, VideoFile) -> Unit
) {
    var entry by remember { mutableStateOf<AnimeEntry?>(null) }
    LaunchedEffect(serverId, path, libraryRootId) {
        try {
            entry = api.loadAnime(serverId, path, libraryRootId)
        } catch (_: Exception) {}
    }
    Scaffold(topBar = { TopAppBar(title = { Text(entry?.metadata?.title ?: path.substringAfterLast('/')) }) }) { padding ->
        val current = entry
        if (current == null) {
            Column(Modifier.fillMaxSize().padding(padding), verticalArrangement = Arrangement.Center) {
                CircularProgressIndicator(Modifier.padding(24.dp))
            }
            return@Scaffold
        }
        LazyColumn(contentPadding = padding, modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            item {
                Row(Modifier.fillMaxWidth().padding(vertical = 16.dp)) {
                    val poster = current.metadata?.posterPath?.let { api.posterUrl(it) }
                    AsyncImage(
                        model = poster,
                        contentDescription = current.metadata?.title,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.width(140.dp).height(210.dp)
                            .clip(RoundedCornerShape(8.dp))
                    )
                    Spacer(Modifier.width(16.dp))
                    Column {
                        Text(current.metadata?.title ?: current.folderName,
                             style = MaterialTheme.typography.headlineSmall)
                        current.metadata?.year?.let { Text("$it", style = MaterialTheme.typography.bodyMedium) }
                        current.metadata?.score?.let { Text("Score: ${"%.2f".format(it)}") }
                        current.metadata?.episodes?.let { Text("$it episodes") }
                    }
                }
            }
            current.metadata?.synopsis?.let { synopsis ->
                if (synopsis.isNotBlank()) item { Text(synopsis, style = MaterialTheme.typography.bodyMedium) }
            }
            item {
                Spacer(Modifier.height(16.dp))
                Text("Episodes", style = MaterialTheme.typography.titleLarge)
            }
            items(current.videos) { video ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .pointerInput(video.path) {
                            detectTapUnit(onTap = { onPlay(current, video) })
                        }
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(video.name, style = MaterialTheme.typography.bodyLarge)
                        Text("${video.size / 1_000_000} MB", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

/** Tiny helper that consumes `detectTapGestures` without introducing a direct dep. */
private suspend fun androidx.compose.ui.input.pointer.PointerInputScope.detectTapUnit(onTap: () -> Unit) {
    androidx.compose.foundation.gestures.detectTapGestures(onTap = { onTap() })
}
