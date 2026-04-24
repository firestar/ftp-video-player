import SwiftUI
import FtpAnimeCore

/// Poster grid backed by `LibraryStore.library`. Tapping an entry pushes
/// `AnimeDetailView`. Layout adapts to size class via an adaptive
/// `LazyVGrid`.
struct LibraryView: View {

    @EnvironmentObject private var appModel: AppModel
    @State private var searchText: String = ""

    var body: some View {
        Group {
            if let store = appModel.store {
                content(store: store)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Library")
    }

    private func content(store: LibraryStore) -> some View {
        ScrollView {
            let columns = [GridItem(.adaptive(minimum: 140, maximum: 200), spacing: 16)]
            LazyVGrid(columns: columns, spacing: 20) {
                ForEach(filtered(in: store)) { entry in
                    NavigationLink(value: entry) {
                        PosterTile(entry: entry)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
        }
        .searchable(text: $searchText, placement: .automatic)
        .refreshable { await store.refreshAll() }
        .navigationDestination(for: AnimeEntry.self) { entry in
            AnimeDetailView(entry: entry)
        }
    }

    private func filtered(in store: LibraryStore) -> [AnimeEntry] {
        guard !searchText.isEmpty else { return store.library }
        let q = searchText.localizedLowercase
        return store.library.filter { entry in
            entry.folderName.localizedLowercase.contains(q)
                || (entry.metadata?.title.localizedLowercase.contains(q) ?? false)
        }
    }
}

/// Single poster cell. Uses the backend's poster cache via
/// `ApiClient.posterURL(path:)`.
struct PosterTile: View {
    let entry: AnimeEntry
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AsyncImage(url: posterURL) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(2/3, contentMode: .fill)
                default:
                    Color.secondary.opacity(0.25).aspectRatio(2/3, contentMode: .fill)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 10))
            Text(entry.metadata?.title ?? entry.folderName)
                .font(.subheadline).lineLimit(2)
        }
    }

    private var posterURL: URL? {
        guard let store = appModel.store, let path = entry.metadata?.posterPath else { return nil }
        return store.api.posterURL(path: path)
    }
}
