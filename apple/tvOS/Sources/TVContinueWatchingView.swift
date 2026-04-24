import SwiftUI
import FtpAnimeCore

struct TVContinueWatchingView: View {
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        ScrollView {
            if let store = appModel.store {
                let unfinished = store.progress.filter { $0.positionSeconds < $0.durationSeconds - 60 }
                if unfinished.isEmpty {
                    Text("Nothing to resume.").font(.title2).foregroundStyle(.secondary).padding(60)
                } else {
                    VStack(alignment: .leading, spacing: 24) {
                        ForEach(unfinished, id: \.path) { p in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(p.animeTitle).font(.title3.bold())
                                Text(p.videoName).font(.body).foregroundStyle(.secondary)
                                ProgressView(value: p.positionSeconds, total: max(1, p.durationSeconds))
                                    .frame(height: 8)
                            }
                            .padding()
                            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                        }
                    }
                    .padding(40)
                }
            }
        }
    }
}
