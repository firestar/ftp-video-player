import SwiftUI
import FtpAnimeCore

/// tvOS poster wall. tvOS's focus engine handles highlight + remote
/// navigation automatically with a `LazyVGrid` wrapped in a focusable
/// `Button`.
struct TVLibraryView: View {

    @EnvironmentObject private var appModel: AppModel
    @State private var selected: AnimeEntry?

    var body: some View {
        NavigationStack {
            ScrollView {
                if let store = appModel.store {
                    let columns = [GridItem(.adaptive(minimum: 260, maximum: 320), spacing: 40)]
                    LazyVGrid(columns: columns, spacing: 40) {
                        ForEach(store.library) { entry in
                            NavigationLink(value: entry) {
                                TVPosterTile(entry: entry)
                            }
                            .buttonStyle(.card)
                        }
                    }
                    .padding(40)
                }
            }
            .navigationDestination(for: AnimeEntry.self) { entry in
                TVAnimeDetailView(entry: entry)
            }
            .navigationTitle("Library")
        }
    }
}

struct TVPosterTile: View {
    let entry: AnimeEntry
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            AsyncImage(url: posterURL) { phase in
                switch phase {
                case .success(let image): image.resizable().aspectRatio(2/3, contentMode: .fill)
                default: Color.secondary.opacity(0.25).aspectRatio(2/3, contentMode: .fill)
                }
            }
            .frame(width: 260, height: 390)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            Text(entry.metadata?.title ?? entry.folderName)
                .font(.title3).lineLimit(2)
        }
    }

    private var posterURL: URL? {
        guard let path = entry.metadata?.posterPath else { return nil }
        return appModel.store?.api.posterURL(path: path)
    }
}
