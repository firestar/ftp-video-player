package com.ftpanimeplayer.core.stream

import com.ftpanimeplayer.core.api.ProbeResult
import com.ftpanimeplayer.core.api.StreamHandle
import com.ftpanimeplayer.core.api.VideoFile

/**
 * Mirror of `apple/Packages/FtpAnimeCore/.../StreamResolver.swift` and the
 * direct-play policy in `server/.../DirectPlayPolicy.java`. Decides whether
 * to point ExoPlayer at `directUrl` (raw FTP byte-range passthrough) or
 * `hlsUrl` (ffmpeg transcode).
 */
object StreamResolver {

    private val directVideoCodecs = setOf("h264", "avc1", "hevc", "h265", "vp8", "vp9", "av1")
    private val directAudioCodecs = setOf("aac", "mp3", "ac3", "eac3", "opus", "vorbis", "flac")
    private val directContainers = setOf("mp4", "m4v", "webm", "mkv")

    fun shouldDirectPlay(video: VideoFile, probe: ProbeResult): Boolean {
        if (probe.directPlayable) return true
        val ext = video.name.substringAfterLast('.', "").lowercase()
        if (ext !in directContainers) return false
        probe.videoCodec?.lowercase()?.let { if (it !in directVideoCodecs) return false }
        probe.audioCodec?.lowercase()?.let { if (it !in directAudioCodecs) return false }
        return true
    }

    fun chooseUrl(handle: StreamHandle, probe: ProbeResult, video: VideoFile): String {
        return if (shouldDirectPlay(video, probe)) handle.directUrl else (handle.hlsUrl ?: handle.transcodeUrl)
    }
}
