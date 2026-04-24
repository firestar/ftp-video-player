import SwiftUI
import AVKit
import FtpAnimeCore

/// AVPlayer-backed full-screen player. Handles:
///   1. register the stream with the backend
///   2. probe codecs
///   3. pick direct-play vs HLS based on `StreamResolver`
///   4. wire up periodic progress reporting back to the backend
struct PlayerView: View {

    let entry: AnimeEntry
    let video: VideoFile

    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var player: AVPlayer?
    @State private var handle: StreamHandle?
    @State private var errorMessage: String?
    @State private var timeObserver: Any?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let player {
                VideoPlayer(player: player)
                    .ignoresSafeArea()
                    .onAppear { player.play() }
            } else if let errorMessage {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle).foregroundStyle(.yellow)
                    Text(errorMessage).foregroundStyle(.white)
                    Button("Close") { dismiss() }
                }
            } else {
                ProgressView().controlSize(.large).tint(.white)
            }
        }
        .task { await prepare() }
        .onDisappear { cleanup() }
    }

    private func prepare() async {
        guard let store = appModel.store else {
            errorMessage = "No backend configured."
            return
        }
        do {
            let request = ApiClient.RegisterRequest(serverId: entry.serverId,
                                                    path: video.path,
                                                    size: video.size)
            let handle = try await store.api.registerStream(request)
            self.handle = handle
            let probe = (try? await store.api.probe(token: handle.token)) ?? ProbeResult(
                container: nil, duration: nil, videoCodec: nil, audioCodec: nil,
                subtitles: [], directPlayable: false)
            let resolver = StreamResolver(handle: handle, probe: probe, video: video)
            guard let url = store.api.playbackURL(for: handle, preferDirect: resolver.shouldDirectPlay) else {
                errorMessage = "Cannot build playback URL."
                return
            }
            let item = AVPlayerItem(url: url)
            let player = AVPlayer(playerItem: item)
            self.player = player
            installProgressObserver(player: player, duration: probe.duration ?? 0)
            if let existing = try? await store.api.getProgress(serverId: entry.serverId, path: video.path),
               existing.positionSeconds > 5 {
                let cm = CMTime(seconds: existing.positionSeconds, preferredTimescale: 600)
                await player.seek(to: cm)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func installProgressObserver(player: AVPlayer, duration: Double) {
        let interval = CMTime(seconds: 10, preferredTimescale: 1)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { time in
            guard let store = appModel.store else { return }
            let position = CMTimeGetSeconds(time)
            guard position.isFinite, position > 0 else { return }
            let progress = VideoProgress(
                serverId: entry.serverId,
                path: video.path,
                size: video.size,
                positionSeconds: position,
                durationSeconds: duration,
                updatedAt: Int64(Date().timeIntervalSince1970 * 1000),
                videoName: video.name,
                animeTitle: entry.metadata?.title ?? entry.folderName,
                posterPath: entry.metadata?.posterPath)
            Task { await store.setProgress(progress) }
        }
    }

    private func cleanup() {
        if let timeObserver, let player { player.removeTimeObserver(timeObserver) }
        timeObserver = nil
        player?.pause()
        player = nil
        if let token = handle?.token, let store = appModel.store {
            Task { try? await store.api.unregisterStream(token: token) }
        }
    }
}
