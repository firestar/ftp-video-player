import SwiftUI
import FtpAnimeCore

/// Decides between the onboarding flow (no backend saved yet) and the main
/// tab navigation. iPad gets a `NavigationSplitView`, iPhone gets a plain
/// `TabView`.
struct RootView: View {

    @EnvironmentObject private var appModel: AppModel
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        if appModel.store == nil {
            OnboardingView()
        } else if sizeClass == .regular {
            iPadShell()
        } else {
            iPhoneShell()
        }
    }
}

private struct iPhoneShell: View {
    @EnvironmentObject private var appModel: AppModel
    var body: some View {
        TabView {
            NavigationStack { LibraryView() }
                .tabItem { Label("Library", systemImage: "square.grid.2x2") }
            NavigationStack { FavoritesView() }
                .tabItem { Label("Favorites", systemImage: "star") }
            NavigationStack { ContinueWatchingView() }
                .tabItem { Label("Continue", systemImage: "play.rectangle") }
            NavigationStack { SettingsView() }
                .tabItem { Label("Settings", systemImage: "gear") }
        }
    }
}

private struct iPadShell: View {
    @State private var selection: SidebarDestination? = .library
    var body: some View {
        NavigationSplitView {
            List(SidebarDestination.allCases, selection: $selection) { dest in
                NavigationLink(value: dest) {
                    Label(dest.title, systemImage: dest.icon)
                }
            }
            .navigationTitle("FTP Anime Player")
        } detail: {
            switch selection ?? .library {
            case .library: LibraryView()
            case .favorites: FavoritesView()
            case .continueWatching: ContinueWatchingView()
            case .settings: SettingsView()
            }
        }
    }
}

private enum SidebarDestination: String, Hashable, CaseIterable, Identifiable {
    case library, favorites, continueWatching, settings
    var id: Self { self }
    var title: String {
        switch self {
        case .library: return "Library"
        case .favorites: return "Favorites"
        case .continueWatching: return "Continue Watching"
        case .settings: return "Settings"
        }
    }
    var icon: String {
        switch self {
        case .library: return "square.grid.2x2"
        case .favorites: return "star"
        case .continueWatching: return "play.rectangle"
        case .settings: return "gear"
        }
    }
}
