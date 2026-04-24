import Foundation

/// Observable cache that the SwiftUI views bind to. Wraps `ApiClient` and
/// memoizes the library + favorites + progress in-memory, same model as
/// the Electron renderer's `api.ts`.
@MainActor
public final class LibraryStore: ObservableObject {

    @Published public private(set) var servers: [FtpServerConfig] = []
    @Published public private(set) var libraryRoots: [LibraryRoot] = []
    @Published public private(set) var library: [AnimeEntry] = []
    @Published public private(set) var favorites: [FavoriteFolder] = []
    @Published public private(set) var progress: [VideoProgress] = []
    @Published public private(set) var isLoading: Bool = false
    @Published public private(set) var lastError: String?

    public private(set) var api: ApiClient

    public init(api: ApiClient) {
        self.api = api
    }

    public func reconfigure(api: ApiClient) {
        self.api = api
        self.library = []
        self.servers = []
        self.libraryRoots = []
        self.favorites = []
        self.progress = []
    }

    public func refreshAll() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let s = api.listServers()
            async let r = api.listLibraryRoots()
            async let l = api.cachedLibrary()
            async let f = api.listFavorites()
            async let p = api.listProgress()
            self.servers = try await s
            self.libraryRoots = try await r
            self.library = try await l
            self.favorites = try await f
            self.progress = try await p
            self.lastError = nil
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    public func upsertServer(_ cfg: FtpServerConfig) async {
        do {
            let saved = try await api.upsertServer(cfg)
            if let idx = servers.firstIndex(where: { $0.id == saved.id }) {
                servers[idx] = saved
            } else {
                servers.append(saved)
            }
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func removeServer(id: String) async {
        do {
            try await api.removeServer(id: id)
            servers.removeAll { $0.id == id }
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func addLibraryRoot(_ root: LibraryRoot) async {
        do {
            let saved = try await api.addLibraryRoot(root)
            libraryRoots.append(saved)
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func removeLibraryRoot(id: String) async {
        do {
            try await api.removeLibraryRoot(id: id)
            libraryRoots.removeAll { $0.id == id }
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func setProgress(_ progress: VideoProgress) async {
        do { try await api.setProgress(progress) }
        catch { lastError = error.localizedDescription }
    }
}
