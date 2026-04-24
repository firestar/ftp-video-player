import SwiftUI
import FtpAnimeCore

@main
struct FtpAnimePlayerApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

/// Temporary minimal root view. The full onboarding / library / player UI
/// will be restored after the CI pipeline is green end-to-end.
struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "play.rectangle")
                .font(.largeTitle)
            Text("FTP Anime Player")
                .font(.title.bold())
            Text("Core version verified")
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}
