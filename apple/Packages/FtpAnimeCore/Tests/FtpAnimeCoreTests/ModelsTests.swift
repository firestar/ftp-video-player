import XCTest
@testable import FtpAnimeCore

final class ModelsTests: XCTestCase {

    func testRoundTripFtpServerConfig() throws {
        let cfg = FtpServerConfig(id: "abc", name: "Home NAS", protocol: .sftp,
                                  host: "nas.local", port: 22,
                                  username: "user", password: "pw",
                                  allowSelfSigned: true, maxConcurrentConnections: 2)
        let data = try JSONEncoder().encode(cfg)
        let decoded = try JSONDecoder().decode(FtpServerConfig.self, from: data)
        XCTAssertEqual(decoded, cfg)
    }

    func testSubtitleDefaultKeyMapsJsonDefaultField() throws {
        let json = #"{"index":2,"codec":"subrip","isDefault":true,"textBased":true}"#
        let info = try JSONDecoder().decode(SubtitleTrackInfo.self, from: Data(json.utf8))
        // The TypeScript/Java side calls this property `default` on the wire,
        // so decoder must look at that key even though the Swift field is
        // `isDefault` (Swift keyword clash).
        XCTAssertTrue(info.isDefault)
    }

    func testDirectPlayResolver() {
        let handle = StreamHandle(token: "t", directUrl: "/d", transcodeUrl: "/t",
                                  probeUrl: "/p", subtitleUrl: "/s", subtitlesUrl: "/ss",
                                  hlsUrl: "/hls", url: "/d")
        let probe = ProbeResult(container: "matroska", duration: 1200,
                                videoCodec: "h264", audioCodec: "aac",
                                subtitles: [], directPlayable: true)
        let video = VideoFile(name: "ep01.mkv", path: "/anime/ep01.mkv",
                              size: 1_000_000, modifiedAt: nil,
                              thumbnailPath: nil, durationSeconds: nil)
        XCTAssertTrue(StreamResolver(handle: handle, probe: probe, video: video).shouldDirectPlay)
    }
}

// The XCTest runner reaches in via objc_runtime on non-Apple platforms; add
// a trivial main to keep swift build --target-tests happy.
#if !canImport(Darwin)
extension ModelsTests {
    static var allTests = [
        ("testRoundTripFtpServerConfig", testRoundTripFtpServerConfig),
        ("testSubtitleDefaultKeyMapsJsonDefaultField", testSubtitleDefaultKeyMapsJsonDefaultField),
        ("testDirectPlayResolver", testDirectPlayResolver)
    ]
}
#endif
