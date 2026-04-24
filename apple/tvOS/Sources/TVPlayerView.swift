import SwiftUI
import AVKit
import FtpAnimeCore

/// tvOS full-screen player. AVPlayerViewController on tvOS handles the remote
/// control gestures (play/pause, skip, scrub) for us.
struct TVPlayerView: View {
    let entry: AnimeEntry
    let video: VideoFile

    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var player: AVPlayer?
    @State private var handle: StreamHandle?
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let player {
                AVPlayerControllerRepresentable(player: player)
                    .ignoresSafeArea()
                    .onAppear { player.play() }
            } else if let errorMessage {
                VStack(spacing: 20) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 80)).foregroundStyle(.yellow)
                    Text(errorMessage).font(.title3).foregroundStyle(.white)
                    Button("Close") { dismiss() }
                }
            } else {
                ProgressView().scaleEffect(2).tint(.white)
            }
        }
        .task { await prepare() }
        .onDisappear { cleanup() }
    }

    private func prepare() async {
        guard let store = appModel.store else {
            errorMessage = "No backend configured."; return
        }
        do {
            let handle = try await store.api.registerStream(
                ApiClient.RegisterRequest(serverId: entry.serverId, path: video.path, size: video.size))
            self.handle = handle
            let probe = (try? await store.api.probe(token: handle.token)) ?? ProbeResult(
                container: nil, duration: nil, videoCodec: nil, audioCodec: nil, subtitles: [], directPlayable: false)
            let resolver = StreamResolver(handle: handle, probe: probe, video: video)
            guard let url = store.api.playbackURL(for: handle, preferDirect: resolver.shouldDirectPlay) else {
                errorMessage = "Cannot build playback URL."; return
            }
            self.player = AVPlayer(playerItem: AVPlayerItem(url: url))
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func cleanup() {
        player?.pause()
        player = nil
        if let token = handle?.token, let store = appModel.store {
            Task { try? await store.api.unregisterStream(token: token) }
        }
    }
}

private struct AVPlayerControllerRepresentable: UIViewControllerRepresentable {
    let player: AVPlayer
    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        return vc
    }
    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {}
}
