import SwiftUI
import FtpAnimeCore

/// Top-level navigation for the Apple TV app. tvOS does not have the same
/// `NavigationStack` + `TabView` combo as iOS; we use a simple tab bar with
/// focus-friendly sections.
struct TVRootView: View {

    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        if appModel.store == nil {
            TVOnboardingView()
        } else {
            TabView {
                TVLibraryView()
                    .tabItem { Text("Library") }
                TVContinueWatchingView()
                    .tabItem { Text("Continue Watching") }
                TVSettingsView()
                    .tabItem { Text("Settings") }
            }
        }
    }
}
