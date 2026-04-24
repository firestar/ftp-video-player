package com.ftpanimeplayer.core.api

import kotlinx.serialization.json.Json
import okhttp3.Credentials
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import java.util.concurrent.TimeUnit

/**
 * Retrofit-based client for the Spring Boot backend. Same endpoints as the
 * iOS/macOS clients. Auth uses HTTP Basic, attached by an OkHttp interceptor.
 *
 * Construct via [ApiClient.create]; the singleton nature is the caller's
 * responsibility (typically held in a ViewModel or Application).
 */
class ApiClient private constructor(
    val config: Configuration,
    val http: OkHttpClient,
    private val service: FtpAnimeService
) : FtpAnimeService by service {

    data class Configuration(val baseUrl: String, val username: String, val password: String)

    /** Absolute URL for an HLS master.m3u8 / direct stream / poster. */
    fun playbackUrl(handle: StreamHandle, preferDirect: Boolean): String {
        val rel = if (preferDirect) handle.directUrl else (handle.hlsUrl ?: handle.transcodeUrl)
        return joinUrl(config.baseUrl, rel)
    }

    fun posterUrl(posterPath: String): String {
        val name = posterPath.substringAfterLast('/')
        return joinUrl(config.baseUrl, "/api/sync/cache/posters/$name")
    }

    companion object {
        fun create(config: Configuration): ApiClient {
            val authInterceptor = Interceptor { chain ->
                val creds = Credentials.basic(config.username, config.password)
                val req = chain.request().newBuilder()
                    .header("Authorization", creds)
                    .header("Accept", "application/json")
                    .build()
                chain.proceed(req)
            }
            val http = OkHttpClient.Builder()
                .addInterceptor(authInterceptor)
                .connectTimeout(20, TimeUnit.SECONDS)
                // Long read timeout because SSE library scans can stay open
                // for minutes while the backend enriches metadata.
                .readTimeout(10, TimeUnit.MINUTES)
                .writeTimeout(30, TimeUnit.SECONDS)
                .build()
            val json = Json {
                ignoreUnknownKeys = true
                explicitNulls = false
            }
            val retrofit = Retrofit.Builder()
                .baseUrl(ensureTrailingSlash(config.baseUrl).toHttpUrl())
                .client(http)
                .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                .build()
            val service = retrofit.create(FtpAnimeService::class.java)
            return ApiClient(config, http, service)
        }

        private fun joinUrl(baseUrl: String, path: String): String {
            val trimmedBase = baseUrl.trimEnd('/')
            val leading = if (path.startsWith("/")) path else "/$path"
            return "$trimmedBase$leading"
        }

        private fun ensureTrailingSlash(url: String) = if (url.endsWith("/")) url else "$url/"
    }
}

interface FtpAnimeService {
    @GET("api/servers") suspend fun listServers(): List<FtpServerConfig>
    @POST("api/servers") suspend fun upsertServer(@Body cfg: FtpServerConfig): FtpServerConfig
    @DELETE("api/servers/{id}") suspend fun removeServer(@Path("id") id: String)
    @POST("api/servers/test") suspend fun testServer(@Body cfg: FtpServerConfig): ConnectionTestResult
    @GET("api/servers/{id}/browse") suspend fun browse(@Path("id") id: String, @Query("path") path: String): List<RemoteEntry>

    @GET("api/library-roots") suspend fun listLibraryRoots(): List<LibraryRoot>
    @POST("api/library-roots") suspend fun addLibraryRoot(@Body root: LibraryRoot): LibraryRoot
    @DELETE("api/library-roots/{id}") suspend fun removeLibraryRoot(@Path("id") id: String)

    @GET("api/library") suspend fun cachedLibrary(): List<AnimeEntry>

    @GET("api/library/anime") suspend fun loadAnime(
        @Query("serverId") serverId: String,
        @Query("path") path: String,
        @Query("libraryRootId") libraryRootId: String
    ): AnimeEntry

    @GET("api/metadata/search") suspend fun searchMetadata(@Query("q") query: String): List<AnimeMetadata>

    @POST("api/stream/register") suspend fun registerStream(@Body req: RegisterStreamRequest): StreamHandle
    @DELETE("api/stream/{token}") suspend fun unregisterStream(@Path("token") token: String)
    @GET("api/stream/{token}/probe") suspend fun probe(@Path("token") token: String): ProbeResult

    @GET("api/progress") suspend fun getProgress(@Query("serverId") serverId: String, @Query("path") path: String): VideoProgress?
    @POST("api/progress") suspend fun setProgress(@Body progress: VideoProgress)
    @GET("api/progress/all") suspend fun listProgress(): List<VideoProgress>

    @GET("api/favorites") suspend fun listFavorites(): List<FavoriteFolder>
    @POST("api/favorites") suspend fun addFavorite(@Body fav: FavoriteFolder): List<FavoriteFolder>
    @HTTP(method = "DELETE", path = "api/favorites")
    suspend fun removeFavorite(@Query("serverId") serverId: String, @Query("path") path: String): List<FavoriteFolder>
}
