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

    public init(id: String, serverId: String, path: String, label: String? = nil) {
        self.id = id; self.serverId = serverId; self.path = path; self.label = label
    }
}

public struct RemoteEntry: Codable, Equatable, Hashable, Sendable {
    public enum EntryType: String, Codable, Sendable { case file, directory }
    public var name: String
    public var path: String
    public var type: EntryType
    public var size: Int64
    public var modifiedAt: Int64?

    public init(name: String, path: String, type: EntryType, size: Int64, modifiedAt: Int64? = nil) {
        self.name = name; self.path = path; self.type = type; self.size = size; self.modifiedAt = modifiedAt
    }
}

public struct VideoFile: Codable, Equatable, Hashable, Sendable {
    public var name: String
    public var path: String
    public var size: Int64
    public var modifiedAt: Int64?
    public var thumbnailPath: String?
    public var durationSeconds: Double?

    public init(name: String, path: String, size: Int64, modifiedAt: Int64? = nil,
                thumbnailPath: String? = nil, durationSeconds: Double? = nil) {
        self.name = name; self.path = path; self.size = size; self.modifiedAt = modifiedAt
        self.thumbnailPath = thumbnailPath; self.durationSeconds = durationSeconds
    }
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

    public init(malId: Int? = nil, title: String, englishTitle: String? = nil,
                japaneseTitle: String? = nil, synopsis: String? = nil, score: Double? = nil,
                year: Int? = nil, episodes: Int? = nil, type: String? = nil,
                genres: [String]? = nil, tags: [String]? = nil, imageUrl: String? = nil,
                posterPath: String? = nil) {
        self.malId = malId; self.title = title; self.englishTitle = englishTitle
        self.japaneseTitle = japaneseTitle; self.synopsis = synopsis; self.score = score
        self.year = year; self.episodes = episodes; self.type = type; self.genres = genres
        self.tags = tags; self.imageUrl = imageUrl; self.posterPath = posterPath
    }
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

    public init(id: String, serverId: String, libraryRootId: String, folderName: String,
                path: String, metadata: AnimeMetadata? = nil, videos: [VideoFile] = [],
                lastScannedAt: Int64? = nil) {
        self.id = id; self.serverId = serverId; self.libraryRootId = libraryRootId
        self.folderName = folderName; self.path = path; self.metadata = metadata
        self.videos = videos; self.lastScannedAt = lastScannedAt
    }
}

public struct FavoriteFolder: Codable, Equatable, Hashable, Sendable {
    public var serverId: String
    public var libraryRootId: String
    public var path: String
    public var addedAt: Int64

    public init(serverId: String, libraryRootId: String, path: String, addedAt: Int64) {
        self.serverId = serverId; self.libraryRootId = libraryRootId
        self.path = path; self.addedAt = addedAt
    }
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

    public init(token: String, directUrl: String, transcodeUrl: String, probeUrl: String,
                subtitleUrl: String, subtitlesUrl: String, hlsUrl: String? = nil, url: String? = nil) {
        self.token = token; self.directUrl = directUrl; self.transcodeUrl = transcodeUrl
        self.probeUrl = probeUrl; self.subtitleUrl = subtitleUrl; self.subtitlesUrl = subtitlesUrl
        self.hlsUrl = hlsUrl; self.url = url
    }
}

public struct SubtitleTrackInfo: Codable, Equatable, Hashable, Sendable {
    public var index: Int
    public var codec: String
    public var language: String?
    public var title: String?
    public var isDefault: Bool
    public var textBased: Bool

    public init(index: Int, codec: String, language: String? = nil, title: String? = nil,
                isDefault: Bool, textBased: Bool) {
        self.index = index; self.codec = codec; self.language = language
        self.title = title; self.isDefault = isDefault; self.textBased = textBased
    }
}

public struct ProbeResult: Codable, Equatable, Hashable, Sendable {
    public var container: String?
    public var duration: Double?
    public var videoCodec: String?
    public var audioCodec: String?
    public var subtitles: [SubtitleTrackInfo]
    public var directPlayable: Bool

    public init(container: String? = nil, duration: Double? = nil, videoCodec: String? = nil,
                audioCodec: String? = nil, subtitles: [SubtitleTrackInfo] = [],
                directPlayable: Bool) {
        self.container = container; self.duration = duration; self.videoCodec = videoCodec
        self.audioCodec = audioCodec; self.subtitles = subtitles; self.directPlayable = directPlayable
    }
}

public struct ConnectionTestResult: Codable, Equatable, Hashable, Sendable {
    public var ok: Bool
    public var error: String?

    public init(ok: Bool, error: String? = nil) {
        self.ok = ok; self.error = error
    }
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

    public init(serverId: String, path: String, size: Int64, positionSeconds: Double,
                durationSeconds: Double, updatedAt: Int64, videoName: String,
                animeTitle: String, posterPath: String? = nil) {
        self.serverId = serverId; self.path = path; self.size = size
        self.positionSeconds = positionSeconds; self.durationSeconds = durationSeconds
        self.updatedAt = updatedAt; self.videoName = videoName
        self.animeTitle = animeTitle; self.posterPath = posterPath
    }
}
