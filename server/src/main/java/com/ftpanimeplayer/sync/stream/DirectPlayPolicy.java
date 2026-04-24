package com.ftpanimeplayer.sync.stream;

import java.util.Set;

/**
 * Codec/container whitelist for direct play. Same rules as
 * {@code src/main/stream-server.ts:73-75}. AVPlayer and ExoPlayer share the
 * same expectations the Electron app already embodies — if the container +
 * codecs are in these sets, the client can stream the raw bytes; otherwise
 * we route through the HLS transcode.
 */
public final class DirectPlayPolicy {

    public static final Set<String> VIDEO_CODECS = Set.of("h264", "avc1", "vp8", "vp9", "av1");
    public static final Set<String> AUDIO_CODECS = Set.of("aac", "mp3", "opus", "vorbis", "flac");
    public static final Set<String> CONTAINERS = Set.of("mp4", "m4v", "webm", "mkv");

    private DirectPlayPolicy() {}

    public static boolean canDirectPlay(String videoCodec, String audioCodec, String filename) {
        String ext = extension(filename);
        if (!CONTAINERS.contains(ext)) return false;
        if (videoCodec != null && !VIDEO_CODECS.contains(videoCodec.toLowerCase())) return false;
        if (audioCodec != null && !AUDIO_CODECS.contains(audioCodec.toLowerCase())) return false;
        return true;
    }

    public static String extension(String filename) {
        if (filename == null) return "";
        int dot = filename.lastIndexOf('.');
        if (dot < 0 || dot == filename.length() - 1) return "";
        return filename.substring(dot + 1).toLowerCase();
    }
}
