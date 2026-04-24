package com.ftpanimeplayer.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.ftpanimeplayer.core.api.AnimeEntry
import com.ftpanimeplayer.core.api.ApiClient
import com.ftpanimeplayer.core.library.LibraryRepository

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(
    repository: LibraryRepository,
    api: ApiClient,
    onEntry: (AnimeEntry) -> Unit,
    onSettings: () -> Unit
) {
    val library by repository.library.collectAsState()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Library") },
                actions = {
                    IconButton(onClick = onSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = "Settings")
                    }
                }
            )
        }
    ) { padding ->
        if (library.isEmpty()) {
            Column(modifier = Modifier.fillMaxSize().padding(padding),
                   verticalArrangement = Arrangement.Center) {
                Text("Library is empty. Add a server in settings, then pull to refresh.",
                     style = MaterialTheme.typography.bodyLarge,
                     modifier = Modifier.padding(24.dp))
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 140.dp),
                contentPadding = padding,
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(12.dp)
            ) {
                items(library) { entry ->
                    PosterTile(entry = entry, api = api, onClick = { onEntry(entry) })
                }
            }
        }
    }
}

@Composable
private fun PosterTile(entry: AnimeEntry, api: ApiClient, onClick: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth()
    ) {
        val posterUrl = entry.metadata?.posterPath?.let { api.posterUrl(it) }
        AsyncImage(
            model = posterUrl,
            contentDescription = entry.metadata?.title ?: entry.folderName,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxWidth().aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(8.dp))
        )
        Text(
            text = entry.metadata?.title ?: entry.folderName,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 2,
            modifier = Modifier.padding(top = 6.dp).fillMaxWidth()
        )
    }
}
