package com.ftpanimeplayer.tv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.tv.foundation.lazy.grid.TvGridCells
import androidx.tv.foundation.lazy.grid.TvLazyVerticalGrid
import androidx.tv.foundation.lazy.grid.items
import androidx.tv.material3.Card
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import com.ftpanimeplayer.core.api.AnimeEntry
import com.ftpanimeplayer.core.api.ApiClient
import com.ftpanimeplayer.core.library.LibraryRepository

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun TvLibraryScreen(
    repository: LibraryRepository,
    api: ApiClient,
    onEntry: (AnimeEntry) -> Unit
) {
    val library by repository.library.collectAsState()
    Column(Modifier.fillMaxSize().padding(48.dp)) {
        Text("Library")
        TvLazyVerticalGrid(
            columns = TvGridCells.Fixed(6),
            verticalArrangement = Arrangement.spacedBy(24.dp),
            horizontalArrangement = Arrangement.spacedBy(24.dp),
            modifier = Modifier.fillMaxSize().padding(top = 24.dp)
        ) {
            items(library) { entry ->
                TvPosterCard(entry = entry, api = api, onClick = { onEntry(entry) })
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun TvPosterCard(entry: AnimeEntry, api: ApiClient, onClick: () -> Unit) {
    Card(onClick = onClick) {
        Column {
            val poster = entry.metadata?.posterPath?.let { api.posterUrl(it) }
            AsyncImage(
                model = poster,
                contentDescription = entry.metadata?.title ?: entry.folderName,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().aspectRatio(2f / 3f)
                    .clip(RoundedCornerShape(12.dp))
            )
            Text(
                text = entry.metadata?.title ?: entry.folderName,
                modifier = Modifier.padding(8.dp),
                maxLines = 2
            )
        }
    }
}
