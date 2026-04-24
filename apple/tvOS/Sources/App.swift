import SwiftUI

@main
struct FtpAnimePlayerTVApp: App {
    var body: some Scene {
        WindowGroup {
            TVContentView()
        }
    }
}

struct TVContentView: View {
    var body: some View {
        VStack(spacing: 40) {
            Text("FTP Anime Player").font(.largeTitle.bold())
            Text("tvOS smoke test").font(.title2).foregroundStyle(.secondary)
        }
        .padding(80)
    }
}
