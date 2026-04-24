import Foundation

/// Swift mirrors of `src/shared/types.ts`. Kept 1:1 with the TypeScript
/// definitions and the Java DTOs under
/// `server/src/main/java/com/ftpanimeplayer/sync/domain/`. When you add a
/// field in one place, add it to all three.

public enum FtpProtocol: String, Codable, Sendable {
    case ftp, ftps, sftp
}

public struct FtpServerConfig: Codable, Identifiable, Equatable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var `protocol`: FtpProtocol
    public var host: String
    public var port: Int
    public var username: String
    public var password: String
    public var secure: Bool?
    public var allowSelfSigned: Bool?
    public var maxConcurrentConnections: Int?

    public init(id: String, name: String, protocol: FtpProtocol, host: String, port: Int,
                username: String, password: String, secure: Bool? = nil,
                allowSelfSigned: Bool? = nil, maxConcurrentConnections: Int? = nil) {
        self.id = id
        self.name = name
        self.`protocol` = `protocol`
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.secure = secure
        self.allowSelfSigned = allowSelfSigned
        self.maxConcurrentConnections = maxConcurrentConnections
    }
}

public struct LibraryRoot: Codable, Identifiable, Equatable, Hashable, Sendable {
    public var id: String
    public var serverId: String
    public var path: String
    public var label: String?
}

public struct RemoteEntry: Codable, Equatable, Hashable, Sendable {
    public enum EntryType: String, Codable, Sendable { case file, directory }
    public var name: String
    public var path: String
    public var type: EntryType
    public var size: Int64
    public var modifiedAt: Int64?
}

public struct VideoFile: Codable, Equatable, Hashable, Sendable {
    public var name: String
    public var path: String
    public var size: Int64
    public var modifiedAt: Int64?
    public var thumbnailPath: String?
    public var durationSeconds: Double?
}

public struct AnimeMetadata: Codable, Equatable, Hashable, Sendable {
    public var malId: Int?
    public var title: String
    public var englishTitle: String?
    public var japaneseTitle: String?
    public var synopsis: String?
    public var score: Double?
    public var year: Int?
    public var episodes: Int?
    public var type: String?
    public var genres: [String]?
    public var tags: [String]?
    public var imageUrl: String?
    public var posterPath: String?
}

public struct AnimeEntry: Codable, Identifiable, Equatable, Hashable, Sendable {
    public var id: String
    public var serverId: String
    public var libraryRootId: String
    public var folderName: String
    public var path: String
    public var metadata: AnimeMetadata?
    public var videos: [VideoFile]
    public var lastScannedAt: Int64?
}

public struct FavoriteFolder: Codable, Equatable, Hashable, Sendable {
    public var serverId: String
    public var libraryRootId: String
    public var path: String
    public var addedAt: Int64
}

public struct StreamHandle: Codable, Equatable, Hashable, Sendable {
    public var token: String
    public var directUrl: String
    public var transcodeUrl: String
    public var probeUrl: String
    public var subtitleUrl: String
    public var subtitlesUrl: String
    public var hlsUrl: String?
    public var url: String?
}

public struct SubtitleTrackInfo: Codable, Equatable, Hashable, Sendable {
    public var index: Int
    public var codec: String
    public var language: String?
    public var title: String?
    public var isDefault: Bool
    public var textBased: Bool
}

public struct ProbeResult: Codable, Equatable, Hashable, Sendable {
    public var container: String?
    public var duration: Double?
    public var videoCodec: String?
    public var audioCodec: String?
    public var subtitles: [SubtitleTrackInfo]
    public var directPlayable: Bool
}

public struct ConnectionTestResult: Codable, Equatable, Hashable, Sendable {
    public var ok: Bool
    public var error: String?
}

public struct VideoProgress: Codable, Equatable, Hashable, Sendable {
    public var serverId: String
    public var path: String
    public var size: Int64
    public var positionSeconds: Double
    public var durationSeconds: Double
    public var updatedAt: Int64
    public var videoName: String
    public var animeTitle: String
    public var posterPath: String?
}
