package com.ftpanimeplayer.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.ftpanimeplayer.core.api.ApiClient
import com.ftpanimeplayer.core.library.LibraryRepository

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    repository: LibraryRepository,
    api: ApiClient,
    onSignOut: () -> Unit
) {
    val servers by repository.servers.collectAsState()
    Scaffold(topBar = { TopAppBar(title = { Text("Settings") }) }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp).fillMaxSize()) {
            Text("Backend", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Text(api.config.baseUrl, style = MaterialTheme.typography.bodyMedium)
            Text("User: ${api.config.username}", style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = onSignOut,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
            ) { Text("Sign out", color = Color.White) }
            Spacer(Modifier.height(24.dp))
            Text("FTP servers", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            if (servers.isEmpty()) {
                Text("No servers configured yet. Use the desktop app or call the API to add them.",
                     style = MaterialTheme.typography.bodySmall)
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(servers) { server ->
                        Card {
                            Column(Modifier.padding(12.dp)) {
                                Text(server.name, style = MaterialTheme.typography.titleSmall)
                                Text("${server.protocol.name.uppercase()}  ${server.host}:${server.port}",
                                     style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }
    }
}
