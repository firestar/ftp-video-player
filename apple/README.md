# FTP Anime Player — Apple clients

Universal iOS/iPadOS app plus an Apple TV app. Both are thin clients that
talk HTTPS to the Spring Boot backend in [`../server`](../server).

## Requirements

- Xcode 15.3+ (tvOS 16 / iOS 16 deployment targets)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) 2.38+ (`brew install xcodegen`)
- A running backend (see `../server/README.md`)

## Layout

```
apple/
├── Packages/FtpAnimeCore/   # Shared Swift package (networking, models)
│   ├── Package.swift
│   └── Sources/FtpAnimeCore/*.swift
├── iOS/                      # iOS + iPadOS universal app target
│   ├── project.yml           # XcodeGen spec
│   ├── Info.plist
│   └── Sources/*.swift
└── tvOS/                     # Apple TV target
    ├── project.yml
    ├── Info.plist
    └── Sources/*.swift
```

## Build

```bash
# Generate the Xcode projects.
(cd apple/iOS && xcodegen generate)
(cd apple/tvOS && xcodegen generate)

# Run in a simulator.
open apple/iOS/FtpAnimePlayer-iOS.xcodeproj
open apple/tvOS/FtpAnimePlayer-tvOS.xcodeproj
```

The `FtpAnimeCore` Swift package can be unit tested independently:

```bash
cd apple/Packages/FtpAnimeCore
swift test
```

## Usage

1. Launch the app in a simulator or on a device.
2. On first run, enter the backend URL (e.g. `http://192.168.1.20:8080`)
   plus the HTTP Basic username/password from `server/src/main/resources/application.yml`.
3. Credentials land in the Keychain and the library grid loads.
4. Tap an anime → tap a video → `AVPlayerViewController` takes over.

## Playback

`StreamResolver` decides whether to send AVPlayer at the backend's
`/api/stream/{token}/direct` (byte-range passthrough) or
`/api/stream/{token}/hls/master.m3u8` (ffmpeg transcode). The whitelist is
kept in sync with the Electron and Android clients — see
[`StreamResolver.swift`](Packages/FtpAnimeCore/Sources/FtpAnimeCore/StreamResolver.swift)
and compare with `src/main/stream-server.ts:73-75` on the desktop side.
