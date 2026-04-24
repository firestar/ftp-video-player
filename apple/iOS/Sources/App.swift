import SwiftUI

@main
struct FtpAnimePlayerApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "play.rectangle").font(.largeTitle)
            Text("FTP Anime Player").font(.title.bold())
            Text("Package-less smoke test").foregroundStyle(.secondary)
        }
        .padding()
    }
}
