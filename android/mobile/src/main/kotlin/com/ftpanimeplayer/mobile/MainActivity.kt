package com.ftpanimeplayer.mobile

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.navigation.compose.rememberNavController
import com.ftpanimeplayer.core.api.ApiClient
import com.ftpanimeplayer.core.auth.CredentialStore
import com.ftpanimeplayer.core.library.LibraryRepository
import com.ftpanimeplayer.mobile.ui.AppNavHost
import com.ftpanimeplayer.mobile.ui.OnboardingScreen
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val vm: AppViewModel by viewModels { AppViewModel.Factory(application) }
        setContent {
            val state by vm.state.collectAsState()
            MaterialTheme(colorScheme = darkColorScheme()) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val navController = rememberNavController()
                    when (val s = state) {
                        is AppState.NeedsCredentials -> OnboardingScreen(
                            onSubmit = { url, user, pass -> vm.connect(url, user, pass) },
                            errorMessage = s.errorMessage
                        )
                        is AppState.Ready -> AppNavHost(
                            navController = navController,
                            repository = s.repository,
                            api = s.api,
                            onSignOut = { vm.signOut() }
                        )
                    }
                }
            }
        }
    }
}

sealed class AppState {
    data class NeedsCredentials(val errorMessage: String? = null) : AppState()
    data class Ready(val repository: LibraryRepository, val api: ApiClient) : AppState()
}

class AppViewModel(application: Application) : AndroidViewModel(application) {

    private val credentials = CredentialStore(application)
    private val _state = MutableStateFlow<AppState>(AppState.NeedsCredentials())
    val state: StateFlow<AppState> = _state.asStateFlow()

    init {
        credentials.load()?.let { creds ->
            bootstrap(creds.baseUrl, creds.username, creds.password)
        }
    }

    fun connect(url: String, user: String, pass: String) {
        viewModelScope.launch {
            try {
                val api = ApiClient.create(ApiClient.Configuration(url, user, pass))
                api.listServers() // probe credentials
                credentials.save(CredentialStore.Credentials(url, user, pass))
                bootstrap(url, user, pass)
            } catch (e: Exception) {
                _state.value = AppState.NeedsCredentials(errorMessage = e.message)
            }
        }
    }

    fun signOut() {
        credentials.clear()
        _state.value = AppState.NeedsCredentials()
    }

    private fun bootstrap(url: String, user: String, pass: String) {
        val api = ApiClient.create(ApiClient.Configuration(url, user, pass))
        val repository = LibraryRepository(api)
        _state.value = AppState.Ready(repository, api)
        viewModelScope.launch { repository.refreshAll() }
    }

    class Factory(private val application: Application) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(AppViewModel::class.java))
            return AppViewModel(application) as T
        }
    }
}
