# Streamstein mobile — build & install

The mobile app lives in `apps/mobile` (Tauri 2 + React/Vite). Its Android scaffolding follows
the shell proven by `apps/readest-app` in the Readstein repo, which is what made this build
possible on this machine without re-solving Android.

## What the app is right now

**0.2.0 — the local library app.** Point it at the folder holding your media and it shows a
scrollable grid of tiles with real thumbnails, durations, and badges for the sibling
transcripts/comments the desktop app writes; tap a tile to play it.

The native commands are `scan_videos` (recursive walk, newest first, with a depth and entry
ceiling), `candidate_roots` (which folders on this device actually hold videos), and
`get_settings` / `set_library_root`. Local playback goes through Tauri's asset protocol, so
`convertFileSrc` needs `security.assetProtocol` enabled in `tauri.conf.json`.

Reading `/sdcard/...` on Android 11+ needs **MANAGE_EXTERNAL_STORAGE** — the user grants it once
in system settings, and the app says so explicitly when a folder comes back unreadable.

**Deliberately not included:** streaming and downloading. The desktop downloads with yt-dlp and
ffmpeg, which are desktop-only binaries; a button that cannot work is worse than no button.
Playback is limited by the WebView's decoders, so MP4/H.264 plays everywhere while MKV/AVI
support varies by device.

## Build the APK

Prerequisites already present on this machine: Android SDK (NDK 29, build-tools 35,
platforms 34/35/36), Rust with the four Android targets
(`rustup target list --installed`), JDK 21, Node 26.

```powershell
# Env the Tauri CLI needs (JAVA_HOME is not set globally on this machine)
$env:ANDROID_HOME    = 'C:\Users\PC\AppData\Local\Android\Sdk'
$env:NDK_HOME        = "$env:ANDROID_HOME\ndk\29.0.13846066"
$env:JAVA_HOME       = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.6.7-hotspot'

cd 'C:\Users\PC\Documents\Coding Projects\Streamstein-Mobile-App\apps\mobile'
npm install
npx tauri android init --ci     # only once: generates src-tauri/gen/android
npx tauri android build --apk --target aarch64
```

A detached launcher exists at `C:\Users\PC\Hermes-Control\repair\build-streamstein-apk.ps1`
because the first Android/Rust build takes many minutes and must survive the calling shell.

Output (unsigned): `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`

## Sign it — Android will not install an unsigned APK

The Tauri build leaves the APK unsigned, so the artifact must be aligned and signed before it
can be sideloaded. The standard Android debug key is used (the same one the Readest APK was
signed with, so no new secret is introduced), which is fine for sideloading and not for Play.

```bash
BT="/c/Users/PC/AppData/Local/Android/Sdk/build-tools/35.0.0"
"$BT/zipalign.exe" -p -f 4 <unsigned.apk> <aligned.apk>
"$BT/apksigner.bat" sign \
  --ks C:/Users/PC/.android/debug.keystore \
  --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android \
  --out release-artifacts/Streamstein-0.1.0-arm64.apk <aligned.apk>
"$BT/apksigner.bat" verify --print-certs release-artifacts/Streamstein-0.1.0-arm64.apk
```

Verify the result, don't assume it: `apksigner verify` must report the signer, and
`aapt2 dump badging` must show `package: name='com.streamstein.app'` plus `native-code:'arm64-v8a'`.

## Installing on the phone

Transfer the APK (email/USB/cloud) and tap it, allowing "install unknown apps" for whichever
app opens it. `adb install` also works with USB debugging on and `platform-tools` on PATH.

## Gotchas hit during the first build

- **Pass `C:/...` paths to native Windows tools** (`apksigner`, `aapt2`, `zipalign`). An MSYS
  path like `/c/Users/...` makes them fail with "The system cannot find the path specified".
- **`JAVA_HOME` is unset** on this machine; Gradle needs it or the build dies early.
- **npm 11 blocks install scripts**, so esbuild's postinstall does not run. It still works via
  its optional platform dependency — confirm with `npx --no-install esbuild --version`.
- Tauri generates the app label **with literal quotes** (`"Streamstein"`). Strip them from
  `gen/android/app/src/main/res/values/strings.xml` or the phone shows a quoted name.
- The generated `gen/android` is committed but its `build/` output should not be.
