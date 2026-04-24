package com.ftpanimeplayer.tv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Button
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import com.ftpanimeplayer.core.api.AnimeEntry
import com.ftpanimeplayer.core.api.ApiClient
import com.ftpanimeplayer.core.api.VideoFile

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun TvAnimeDetailScreen(
    entry: AnimeEntry,
    api: ApiClient,
    onPlay: (AnimeEntry, VideoFile) -> Unit,
    onBack: () -> Unit
) {
    var hydrated by remember { mutableStateOf(entry) }
    LaunchedEffect(entry.path) {
        runCatching { api.loadAnime(entry.serverId, entry.path, entry.libraryRootId) }
            .onSuccess { hydrated = it }
    }
    Row(Modifier.fillMaxSize().padding(48.dp)) {
        val poster = hydrated.metadata?.posterPath?.let { api.posterUrl(it) }
        AsyncImage(
            model = poster,
            contentDescription = hydrated.metadata?.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.width(360.dp)
                .clip(RoundedCornerShape(16.dp))
        )
        Spacer(Modifier.width(48.dp))
        Column(Modifier.fillMaxSize()) {
            Text(hydrated.metadata?.title ?: hydrated.folderName)
            Spacer(Modifier.height(12.dp))
            hydrated.metadata?.synopsis?.let {
                Column(
                    modifier = Modifier.height(260.dp).verticalScroll(rememberScrollState())
                ) { Text(it) }
            }
            Spacer(Modifier.height(24.dp))
            Text("Episodes")
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(top = 12.dp)
            ) {
                hydrated.videos.forEach { video ->
                    Button(onClick = { onPlay(hydrated, video) }) {
                        Text(video.name)
                    }
                }
            }
        }
    }
}
