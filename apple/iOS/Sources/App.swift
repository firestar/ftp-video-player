import SwiftUI
import FtpAnimeCore

/// iOS/iPadOS app entry. One scene, one root view; the root view switches
/// between onboarding (no backend configured) and the main library navigation
/// based on the stored credentials.
@main
struct FtpAnimePlayerApp: App {

    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .task { await model.bootstrap() }
        }
    }
}

/// Top-level app state. Holds the `LibraryStore` and the credentials the
/// user configured; rebuilds the `ApiClient` whenever credentials change.
@MainActor
final class AppModel: ObservableObject {

    @Published var credentials: CredentialStore.Credentials?
    @Published var store: LibraryStore?

    func bootstrap() async {
        self.credentials = CredentialStore.load()
        if let credentials {
            let client = ApiClient(configuration: .init(baseURL: credentials.baseURL,
                                                         username: credentials.username,
                                                         password: credentials.password))
            let libraryStore = LibraryStore(api: client)
            self.store = libraryStore
            await libraryStore.refreshAll()
        }
    }

    func save(credentials: CredentialStore.Credentials) async {
        try? CredentialStore.save(credentials)
        self.credentials = credentials
        let client = ApiClient(configuration: .init(baseURL: credentials.baseURL,
                                                     username: credentials.username,
                                                     password: credentials.password))
        let libraryStore = LibraryStore(api: client)
        self.store = libraryStore
        await libraryStore.refreshAll()
    }

    func signOut() {
        CredentialStore.clear()
        self.credentials = nil
        self.store = nil
    }
}
