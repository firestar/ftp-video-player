import SwiftUI
import FtpAnimeCore

@main
struct FtpAnimePlayerTVApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            TVRootView()
                .environmentObject(model)
                .task { await model.bootstrap() }
        }
    }
}

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
            let lib = LibraryStore(api: client)
            self.store = lib
            await lib.refreshAll()
        }
    }

    func save(_ credentials: CredentialStore.Credentials) async {
        try? CredentialStore.save(credentials)
        self.credentials = credentials
        let client = ApiClient(configuration: .init(baseURL: credentials.baseURL,
                                                     username: credentials.username,
                                                     password: credentials.password))
        let lib = LibraryStore(api: client)
        self.store = lib
        await lib.refreshAll()
    }

    func signOut() {
        CredentialStore.clear()
        self.credentials = nil
        self.store = nil
    }
}
