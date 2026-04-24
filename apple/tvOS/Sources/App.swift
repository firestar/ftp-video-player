import SwiftUI
import FtpAnimeCore

@main
struct FtpAnimePlayerTVApp: App {
    var body: some Scene {
        WindowGroup {
            TVContentView()
        }
    }
}

/// Temporary minimal root view — restored to a full UI once the CI pipeline
/// is green.
struct TVContentView: View {
    var body: some View {
        VStack(spacing: 40) {
            Text("FTP Anime Player").font(.largeTitle.bold())
            Text("Apple TV build").font(.title2).foregroundStyle(.secondary)
        }
        .padding(80)
    }
}
