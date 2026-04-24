import Foundation

/// Decides between direct-play and HLS transcode for a given video. Mirrors
/// the logic at `src/main/stream-server.ts:189` (`deriveDirectPlayable`) and
/// `server/.../DirectPlayPolicy.java`: AVPlayer handles H.264/HEVC/VP9 in
/// `mp4/m4v/webm/mkv` containers; everything else goes through HLS.
public struct StreamResolver: Sendable {

    /// Direct-play codec whitelist. Kept in sync with the backend policy.
    public static let directVideoCodecs: Set<String> = ["h264", "avc1", "hevc", "h265", "vp8", "vp9", "av1"]
    public static let directAudioCodecs: Set<String> = ["aac", "mp3", "ac3", "eac3", "opus", "vorbis", "flac"]
    public static let directContainers: Set<String> = ["mp4", "m4v", "webm", "mkv"]

    public let handle: StreamHandle
    public let probe: ProbeResult
    public let video: VideoFile

    public init(handle: StreamHandle, probe: ProbeResult, video: VideoFile) {
        self.handle = handle
        self.probe = probe
        self.video = video
    }

    public var shouldDirectPlay: Bool {
        if probe.directPlayable { return true }
        let ext = (video.name as NSString).pathExtension.lowercased()
        guard Self.directContainers.contains(ext) else { return false }
        if let v = probe.videoCodec, !Self.directVideoCodecs.contains(v.lowercased()) { return false }
        if let a = probe.audioCodec, !Self.directAudioCodecs.contains(a.lowercased()) { return false }
        return true
    }
}
