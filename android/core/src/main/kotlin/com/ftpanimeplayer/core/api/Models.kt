package com.ftpanimeplayer.core.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire DTOs. Kept 1:1 with `src/shared/types.ts` and the Java domain
 * classes in `server/src/main/java/com/ftpanimeplayer/sync/domain/`.
 * When you rename or add a field in one place, update all three.
 */

@Serializable
enum class FtpProtocol { ftp, ftps, sftp }

@Serializable
data class FtpServerConfig(
    val id: String,
    val name: String,
    val protocol: FtpProtocol,
    val host: String,
    val port: Int,
    val username: String,
    val password: String,
    val secure: Boolean? = null,
    val allowSelfSigned: Boolean? = null,
    val maxConcurrentConnections: Int? = null
)

@Serializable
data class LibraryRoot(
    val id: String,
    val serverId: String,
    val path: String,
    val label: String? = null
)

@Serializable
data class RemoteEntry(
    val name: String,
    val path: String,
    val type: Type,
    val size: Long,
    val modifiedAt: Long? = null
) {
    @Serializable enum class Type { file, directory }
}

@Serializable
data class VideoFile(
    val name: String,
    val path: String,
    val size: Long,
    val modifiedAt: Long? = null,
    val thumbnailPath: String? = null,
    val durationSeconds: Double? = null
)

@Serializable
data class AnimeMetadata(
    val malId: Int? = null,
    val title: String,
    val englishTitle: String? = null,
    val japaneseTitle: String? = null,
    val synopsis: String? = null,
    val score: Double? = null,
    val year: Int? = null,
    val episodes: Int? = null,
    val type: String? = null,
    val genres: List<String>? = null,
    val tags: List<String>? = null,
    val imageUrl: String? = null,
    val posterPath: String? = null
)

@Serializable
data class AnimeEntry(
    val id: String,
    val serverId: String,
    val libraryRootId: String,
    val folderName: String,
    val path: String,
    val metadata: AnimeMetadata? = null,
    val videos: List<VideoFile> = emptyList(),
    val lastScannedAt: Long? = null
)

@Serializable
data class FavoriteFolder(
    val serverId: String,
    val libraryRootId: String,
    val path: String,
    val addedAt: Long
)

@Serializable
data class StreamHandle(
    val token: String,
    val directUrl: String,
    val transcodeUrl: String,
    val probeUrl: String,
    val subtitleUrl: String,
    val subtitlesUrl: String,
    val hlsUrl: String? = null,
    val url: String? = null
)

@Serializable
data class SubtitleTrackInfo(
    val index: Int,
    val codec: String,
    val language: String? = null,
    val title: String? = null,
    @SerialName("isDefault") val isDefault: Boolean,
    val textBased: Boolean
)

@Serializable
data class ProbeResult(
    val container: String? = null,
    val duration: Double? = null,
    val videoCodec: String? = null,
    val audioCodec: String? = null,
    val subtitles: List<SubtitleTrackInfo> = emptyList(),
    val directPlayable: Boolean
)

@Serializable
data class ConnectionTestResult(val ok: Boolean, val error: String? = null)

@Serializable
data class VideoProgress(
    val serverId: String,
    val path: String,
    val size: Long,
    val positionSeconds: Double,
    val durationSeconds: Double,
    val updatedAt: Long,
    val videoName: String,
    val animeTitle: String,
    val posterPath: String? = null
)

@Serializable
data class RegisterStreamRequest(val serverId: String, val path: String, val size: Long)
