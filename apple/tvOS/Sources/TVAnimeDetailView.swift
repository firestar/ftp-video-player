import SwiftUI
import FtpAnimeCore

struct TVAnimeDetailView: View {
    let entry: AnimeEntry

    @EnvironmentObject private var appModel: AppModel
    @State private var hydrated: AnimeEntry
    @State private var playingVideo: VideoFile?

    init(entry: AnimeEntry) {
        self.entry = entry
        self._hydrated = State(initialValue: entry)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 40) {
            AsyncImage(url: posterURL) { phase in
                switch phase {
                case .success(let image): image.resizable().aspectRatio(2/3, contentMode: .fit)
                default: Color.secondary.opacity(0.25).aspectRatio(2/3, contentMode: .fit)
                }
            }
            .frame(width: 400)
            .clipShape(RoundedRectangle(cornerRadius: 18))

            VStack(alignment: .leading, spacing: 20) {
                Text(hydrated.metadata?.title ?? hydrated.folderName).font(.largeTitle.bold())
                if let synopsis = hydrated.metadata?.synopsis, !synopsis.isEmpty {
                    ScrollView {
                        Text(synopsis).font(.title3).foregroundStyle(.secondary)
                    }
                    .frame(maxHeight: 320)
                }
                Divider()
                Text("Episodes").font(.title2.bold())
                ScrollView {
                    LazyVStack(alignment: .leading) {
                        ForEach(hydrated.videos, id: \.path) { video in
                            Button { playingVideo = video } label: {
                                HStack {
                                    Image(systemName: "play.circle.fill").font(.title)
                                    Text(video.name).font(.title3)
                                    Spacer()
                                }
                                .padding()
                            }
                            .buttonStyle(.card)
                        }
                    }
                }
            }
        }
        .padding(40)
        .task { await hydrate() }
        .fullScreenCover(item: $playingVideo) { video in
            TVPlayerView(entry: hydrated, video: video)
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
            hydrated = try await store.api.loadAnime(serverId: entry.serverId,
                                                      path: entry.path,
                                                      libraryRootId: entry.libraryRootId)
        } catch {
            // ignore
        }
    }
}

extension VideoFile: Identifiable {
    public var id: String { path }
}
