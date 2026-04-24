import SwiftUI
import FtpAnimeCore

struct FavoritesView: View {
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        List {
            if let store = appModel.store {
                if store.favorites.isEmpty {
                    Text("No favorites yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(store.favorites, id: \.path) { fav in
                        HStack {
                            Image(systemName: "star.fill").foregroundStyle(.yellow)
                            VStack(alignment: .leading) {
                                Text((fav.path as NSString).lastPathComponent)
                                Text(fav.path).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Favorites")
    }
}
