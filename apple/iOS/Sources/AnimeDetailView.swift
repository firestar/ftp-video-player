import SwiftUI
import FtpAnimeCore

/// Shows one anime entry's metadata + video list. Tapping a video presents
/// `PlayerView` modally.
struct AnimeDetailView: View {
    let entry: AnimeEntry

    @EnvironmentObject private var appModel: AppModel
    @State private var hydrated: AnimeEntry
    @State private var playingVideo: VideoFile?

    init(entry: AnimeEntry) {
        self.entry = entry
        self._hydrated = State(initialValue: entry)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let synopsis = hydrated.metadata?.synopsis, !synopsis.isEmpty {
                    Text(synopsis).font(.body).foregroundStyle(.secondary)
                }
                videoList
            }
            .padding()
        }
        .navigationTitle(hydrated.metadata?.title ?? hydrated.folderName)
        .navigationBarTitleDisplayMode(.large)
        .task { await hydrate() }
        .fullScreenCover(item: $playingVideo) { video in
            PlayerView(entry: hydrated, video: video)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            AsyncImage(url: posterURL) { phase in
                switch phase {
                case .success(let image): image.resizable().aspectRatio(2/3, contentMode: .fit)
                default: Color.secondary.opacity(0.25).aspectRatio(2/3, contentMode: .fit)
                }
            }
            .frame(width: 140)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 6) {
                Text(hydrated.metadata?.title ?? hydrated.folderName).font(.title2.bold())
                if let year = hydrated.metadata?.year {
                    Text(String(year)).font(.subheadline).foregroundStyle(.secondary)
                }
                if let score = hydrated.metadata?.score {
                    Label(String(format: "%.2f", score), systemImage: "star.fill")
                        .foregroundStyle(.yellow)
                }
                if let episodes = hydrated.metadata?.episodes {
                    Text("\(episodes) episodes").font(.subheadline)
                }
            }
            Spacer()
        }
    }

    private var videoList: some View {
        VStack(alignment: .leading) {
            Text("Episodes").font(.headline)
            ForEach(hydrated.videos, id: \.path) { video in
                Button {
                    playingVideo = video
                } label: {
                    HStack {
                        Image(systemName: "play.rectangle.fill").foregroundStyle(.accent)
                        VStack(alignment: .leading) {
                            Text(video.name).lineLimit(1)
                            Text(format(size: video.size))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
                Divider()
            }
        }
    }

    private var posterURL: URL? {
        guard let path = hydrated.metadata?.posterPath else { return nil }
        return appModel.store?.api.posterURL(path: path)
    }

    private func hydrate() async {
        guard let store = appModel.store else { return }
        if !hydrated.videos.isEmpty && hydrated.metadata != nil { return }
        do {
            let fresh = try await store.api.loadAnime(serverId: entry.serverId,
                                                       path: entry.path,
                                                       libraryRootId: entry.libraryRootId)
            hydrated = fresh
        } catch {
            // Keep whatever stale data we had; next pull-to-refresh will retry.
        }
    }

    private func format(size: Int64) -> String {
        let fmt = ByteCountFormatter()
        fmt.countStyle = .file
        return fmt.string(fromByteCount: size)
    }
}

extension VideoFile: Identifiable {
    public var id: String { path }
}
