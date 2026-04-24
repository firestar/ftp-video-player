package com.ftpanimeplayer.tv

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.darkColorScheme
import com.ftpanimeplayer.core.api.ApiClient
import com.ftpanimeplayer.core.auth.CredentialStore
import com.ftpanimeplayer.core.library.LibraryRepository
import com.ftpanimeplayer.tv.ui.OnboardingTvScreen
import com.ftpanimeplayer.tv.ui.TvRootScreen
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    @OptIn(ExperimentalTvMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val vm: TvAppViewModel by viewModels { TvAppViewModel.Factory(application) }
        setContent {
            val state by vm.state.collectAsState()
            MaterialTheme(colorScheme = darkColorScheme()) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    when (val s = state) {
                        is TvState.NeedsCredentials -> OnboardingTvScreen(
                            onSubmit = { url, u, p -> vm.connect(url, u, p) },
                            errorMessage = s.errorMessage
                        )
                        is TvState.Ready -> TvRootScreen(
                            repository = s.repository,
                            api = s.api
                        )
                    }
                }
            }
        }
    }
}

sealed class TvState {
    data class NeedsCredentials(val errorMessage: String? = null) : TvState()
    data class Ready(val repository: LibraryRepository, val api: ApiClient) : TvState()
}

class TvAppViewModel(application: Application) : AndroidViewModel(application) {
    private val credentials = CredentialStore(application)
    private val _state = MutableStateFlow<TvState>(TvState.NeedsCredentials())
    val state: StateFlow<TvState> = _state.asStateFlow()

    init {
        credentials.load()?.let { bootstrap(it.baseUrl, it.username, it.password) }
    }

    fun connect(url: String, user: String, pass: String) {
        viewModelScope.launch {
            try {
                val api = ApiClient.create(ApiClient.Configuration(url, user, pass))
                api.listServers()
                credentials.save(CredentialStore.Credentials(url, user, pass))
                bootstrap(url, user, pass)
            } catch (e: Exception) {
                _state.value = TvState.NeedsCredentials(errorMessage = e.message)
            }
        }
    }

    private fun bootstrap(url: String, user: String, pass: String) {
        val api = ApiClient.create(ApiClient.Configuration(url, user, pass))
        val repo = LibraryRepository(api)
        _state.value = TvState.Ready(repo, api)
        viewModelScope.launch { repo.refreshAll() }
    }

    class Factory(private val application: Application) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(TvAppViewModel::class.java))
            return TvAppViewModel(application) as T
        }
    }
}
