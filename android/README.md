# FTP Anime Player — Android clients

Phone + Android TV apps, both Kotlin + Jetpack Compose + Media3. Thin
clients for the Spring Boot backend in [`../server`](../server).

## Requirements

- JDK 17
- Android SDK 34 (compile + target), minSdk 23
- Gradle 8.9 (install locally or use Android Studio's bundled one)
- A running backend (see `../server/README.md`)

## Layout

```
android/
├── settings.gradle.kts      # Declares :core :mobile :tv modules
├── build.gradle.kts
├── core/                    # Shared Kotlin library: API, models, credentials
│   ├── build.gradle.kts
│   └── src/main/kotlin/com/ftpanimeplayer/core/**
├── mobile/                  # Phone/tablet application
│   ├── build.gradle.kts
│   └── src/main/kotlin/com/ftpanimeplayer/mobile/**
└── tv/                      # Android TV application (Leanback launcher)
    ├── build.gradle.kts
    └── src/main/kotlin/com/ftpanimeplayer/tv/**
```

## Build

```bash
cd android
gradle :mobile:assembleDebug   # phone APK in mobile/build/outputs/apk/debug/
gradle :tv:assembleDebug       # tv APK in tv/build/outputs/apk/debug/
```

Or open the `android/` directory in Android Studio and run either module.

## Usage

1. Install the APK on a device, emulator, or Android TV emulator
   (`system-images;android-34;google_apis_playstore;x86_64` with a TV
   hardware profile).
2. Onboarding screen asks for backend URL + HTTP Basic credentials. They
   go into `EncryptedSharedPreferences`.
3. Browse the library grid → select an anime → press Play on an episode.
   Media3 ExoPlayer handles both direct-play and HLS transcode URLs.

## Architecture note

`StreamResolver` keeps the same codec whitelist as the iOS and desktop
apps. See `core/src/main/kotlin/com/ftpanimeplayer/core/stream/StreamResolver.kt`.
