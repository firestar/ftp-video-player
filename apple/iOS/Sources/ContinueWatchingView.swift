import SwiftUI
import FtpAnimeCore

struct ContinueWatchingView: View {
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        List {
            if let store = appModel.store {
                let unfinished = store.progress.filter { $0.positionSeconds < $0.durationSeconds - 60 }
                if unfinished.isEmpty {
                    Text("Nothing to resume.").foregroundStyle(.secondary)
                } else {
                    ForEach(unfinished, id: \.path) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(entry.videoName).font(.headline)
                            Text(entry.animeTitle).font(.subheadline).foregroundStyle(.secondary)
                            ProgressView(value: entry.positionSeconds, total: max(1, entry.durationSeconds))
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
        .navigationTitle("Continue Watching")
    }
}
