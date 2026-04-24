import Foundation

/// Typed async wrapper around the Spring Boot REST API. Every call uses
/// HTTP Basic auth (same credentials as the existing sync endpoint).
///
/// Backend URL and credentials are stored outside this type — the caller
/// builds it with a `Configuration` and then the `@Published` state in
/// `LibraryStore` keeps the UI in sync.
public actor ApiClient {

    public struct Configuration: Equatable, Sendable {
        public var baseURL: URL
        public var username: String
        public var password: String

        public init(baseURL: URL, username: String, password: String) {
            self.baseURL = baseURL
            self.username = username
            self.password = password
        }
    }

    public enum ApiError: LocalizedError {
        case badStatus(Int, String?)
        case decode(Error)
        case transport(Error)

        public var errorDescription: String? {
            switch self {
            case .badStatus(let code, let body): return "HTTP \(code)\(body.map { ": \($0)" } ?? "")"
            case .decode(let err): return "decode failed: \(err.localizedDescription)"
            case .transport(let err): return err.localizedDescription
            }
        }
    }

    private let configuration: Configuration
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(configuration: Configuration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    public var baseURL: URL { configuration.baseURL }

    // MARK: - servers

    public func listServers() async throws -> [FtpServerConfig] {
        try await get("/api/servers")
    }

    public func upsertServer(_ cfg: FtpServerConfig) async throws -> FtpServerConfig {
        try await post("/api/servers", body: cfg)
    }

    public func removeServer(id: String) async throws {
        _ = try await request(method: "DELETE", path: "/api/servers/\(id)")
    }

    public func testServer(_ cfg: FtpServerConfig) async throws -> ConnectionTestResult {
        try await post("/api/servers/test", body: cfg)
    }

    public func browse(serverId: String, path: String) async throws -> [RemoteEntry] {
        try await get("/api/servers/\(serverId)/browse", query: ["path": path])
    }

    // MARK: - library

    public func listLibraryRoots() async throws -> [LibraryRoot] {
        try await get("/api/library-roots")
    }

    public func addLibraryRoot(_ root: LibraryRoot) async throws -> LibraryRoot {
        try await post("/api/library-roots", body: root)
    }

    public func removeLibraryRoot(id: String) async throws {
        _ = try await request(method: "DELETE", path: "/api/library-roots/\(id)")
    }

    public func cachedLibrary() async throws -> [AnimeEntry] {
        try await get("/api/library")
    }

    public func loadAnime(serverId: String, path: String, libraryRootId: String) async throws -> AnimeEntry {
        try await get("/api/library/anime", query: [
            "serverId": serverId,
            "path": path,
            "libraryRootId": libraryRootId
        ])
    }

    // MARK: - metadata

    public func searchMetadata(query: String) async throws -> [AnimeMetadata] {
        try await get("/api/metadata/search", query: ["q": query])
    }

    // MARK: - streaming

    public struct RegisterRequest: Codable, Sendable {
        public var serverId: String
        public var path: String
        public var size: Int64
        public init(serverId: String, path: String, size: Int64) {
            self.serverId = serverId; self.path = path; self.size = size
        }
    }

    public func registerStream(_ req: RegisterRequest) async throws -> StreamHandle {
        try await post("/api/stream/register", body: req)
    }

    public func unregisterStream(token: String) async throws {
        _ = try await request(method: "DELETE", path: "/api/stream/\(token)")
    }

    public func probe(token: String) async throws -> ProbeResult {
        try await get("/api/stream/\(token)/probe")
    }

    // MARK: - progress / favorites

    public func getProgress(serverId: String, path: String) async throws -> VideoProgress? {
        let data = try await request(method: "GET", path: "/api/progress", query: ["serverId": serverId, "path": path])
        if data.isEmpty { return nil }
        return try decode(data)
    }

    public func setProgress(_ progress: VideoProgress) async throws {
        _ = try await request(method: "POST", path: "/api/progress", body: progress)
    }

    public func listProgress() async throws -> [VideoProgress] {
        try await get("/api/progress/all")
    }

    public func listFavorites() async throws -> [FavoriteFolder] {
        try await get("/api/favorites")
    }

    public func addFavorite(_ favorite: FavoriteFolder) async throws -> [FavoriteFolder] {
        try await post("/api/favorites", body: favorite)
    }

    public func removeFavorite(serverId: String, path: String) async throws -> [FavoriteFolder] {
        let data = try await request(method: "DELETE", path: "/api/favorites", query: ["serverId": serverId, "path": path])
        return try decode(data)
    }

    // MARK: - URL builders

    /// Produce a fully-qualified playback URL for AVPlayer. Includes HTTP
    /// Basic credentials via `URLComponents.user/.password` so AVPlayer
    /// hits the Spring Boot endpoint without needing a custom loader.
    /// `nonisolated` because this only reads the immutable `configuration`.
    public nonisolated func playbackURL(for handle: StreamHandle, preferDirect: Bool) -> URL? {
        let rel = (preferDirect ? handle.directUrl : (handle.hlsUrl ?? handle.transcodeUrl))
        guard var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false) else { return nil }
        let joined = rel.hasPrefix("/") ? rel : "/\(rel)"
        components.path = joined
        components.user = configuration.username
        components.password = configuration.password
        return components.url
    }

    public nonisolated func posterURL(path: String) -> URL? {
        guard var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false) else { return nil }
        let name = (path as NSString).lastPathComponent
        components.path = "/api/sync/cache/posters/\(name)"
        components.user = configuration.username
        components.password = configuration.password
        return components.url
    }

    // MARK: - internals

    private func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        let data = try await request(method: "GET", path: path, query: query)
        return try decode(data)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let data = try await request(method: "POST", path: path, body: body)
        return try decode(data)
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try decoder.decode(T.self, from: data) }
        catch { throw ApiError.decode(error) }
    }

    private func request(method: String, path: String, query: [String: String] = [:], body: Encodable? = nil) async throws -> Data {
        guard var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false) else {
            throw ApiError.transport(URLError(.badURL))
        }
        components.path = path
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { throw ApiError.transport(URLError(.badURL)) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        let credential = "\(configuration.username):\(configuration.password)"
        if let auth = credential.data(using: .utf8)?.base64EncodedString() {
            request.setValue("Basic \(auth)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = try encoder.encode(AnyEncodable(body))
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw ApiError.transport(URLError(.badServerResponse))
            }
            if http.statusCode == 404 { return Data() }
            if !(200..<300).contains(http.statusCode) {
                let body = String(data: data, encoding: .utf8)
                throw ApiError.badStatus(http.statusCode, body)
            }
            return data
        } catch let apiError as ApiError {
            throw apiError
        } catch {
            throw ApiError.transport(error)
        }
    }
}

/// Erases a concrete `Encodable` so the generic `request` signature stays
/// simple; Swift doesn't allow `any Encodable` in all the places we'd want.
private struct AnyEncodable: Encodable {
    let wrapped: Encodable

    init(_ wrapped: Encodable) { self.wrapped = wrapped }

    func encode(to encoder: Encoder) throws {
        try wrapped.encode(to: encoder)
    }
}
