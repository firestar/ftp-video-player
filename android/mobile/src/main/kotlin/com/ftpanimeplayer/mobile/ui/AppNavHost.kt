package com.ftpanimeplayer.mobile.ui

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.ftpanimeplayer.core.api.ApiClient
import com.ftpanimeplayer.core.library.LibraryRepository

/**
 * Three-destination navigation graph: library (home), anime detail, player.
 * The player is passed the token/urls via query parameters from anime detail.
 */
@Composable
fun AppNavHost(
    navController: NavHostController,
    repository: LibraryRepository,
    api: ApiClient,
    onSignOut: () -> Unit
) {
    NavHost(navController = navController, startDestination = Routes.LIBRARY) {
        composable(Routes.LIBRARY) {
            LibraryScreen(
                repository = repository,
                api = api,
                onEntry = { entry ->
                    navController.navigate(
                        "${Routes.ANIME}/${entry.serverId}/${entry.libraryRootId}/${android.net.Uri.encode(entry.path)}"
                    )
                },
                onSettings = { navController.navigate(Routes.SETTINGS) }
            )
        }
        composable("${Routes.ANIME}/{serverId}/{libraryRootId}/{path}") { backStack ->
            val serverId = backStack.arguments?.getString("serverId").orEmpty()
            val libraryRootId = backStack.arguments?.getString("libraryRootId").orEmpty()
            val path = android.net.Uri.decode(backStack.arguments?.getString("path").orEmpty())
            AnimeDetailScreen(
                repository = repository,
                api = api,
                serverId = serverId,
                libraryRootId = libraryRootId,
                path = path,
                onPlay = { anime, video ->
                    navController.navigate(
                        "${Routes.PLAYER}/${video.serverId(anime)}/${android.net.Uri.encode(video.path)}/${video.size}"
                    )
                }
            )
        }
        composable("${Routes.PLAYER}/{serverId}/{path}/{size}") { backStack ->
            val serverId = backStack.arguments?.getString("serverId").orEmpty()
            val path = android.net.Uri.decode(backStack.arguments?.getString("path").orEmpty())
            val size = backStack.arguments?.getString("size")?.toLongOrNull() ?: 0L
            PlayerScreen(api = api, repository = repository,
                         serverId = serverId, path = path, size = size,
                         onExit = { navController.popBackStack() })
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(repository = repository, api = api, onSignOut = onSignOut)
        }
    }
}

/** Helper extension so `PlayerScreen` can be navigated to without passing the entire AnimeEntry. */
private fun com.ftpanimeplayer.core.api.VideoFile.serverId(parent: com.ftpanimeplayer.core.api.AnimeEntry) = parent.serverId

object Routes {
    const val LIBRARY = "library"
    const val ANIME = "anime"
    const val PLAYER = "player"
    const val SETTINGS = "settings"
}
