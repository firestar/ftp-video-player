// swift-tools-version: 5.9
import PackageDescription

/// Shared core for the iOS, iPadOS, and tvOS apps. Contains:
/// * `ApiClient` — typed async wrapper around the Spring Boot REST API.
/// * `Models` — Codable structs that match `src/shared/types.ts` 1:1 and the
///   server's `domain/*.java` DTOs.
/// * `LibraryStore` — ObservableObject cache of servers + library + progress.
/// * `StreamResolver` — picks between direct-play and HLS based on probe data.
///
/// Target OSes chosen to cover the plan: iOS 16 (phones + iPads), tvOS 16
/// (Apple TV HD / 4K).
let package = Package(
    name: "FtpAnimeCore",
    platforms: [
        .iOS(.v16),
        .tvOS(.v16),
        // `swift test` runs the test target as a native macOS binary, so the
        // package must also declare a macOS deployment target recent enough
        // for the modern APIs used here (URLSession.data(for:), @MainActor,
        // async/await, Keychain). macOS 13 clears all of those.
        .macOS(.v13)
    ],
    products: [
        .library(name: "FtpAnimeCore", targets: ["FtpAnimeCore"])
    ],
    targets: [
        .target(
            name: "FtpAnimeCore",
            path: "Sources/FtpAnimeCore"
        ),
        .testTarget(
            name: "FtpAnimeCoreTests",
            dependencies: ["FtpAnimeCore"],
            path: "Tests/FtpAnimeCoreTests"
        )
    ]
)
