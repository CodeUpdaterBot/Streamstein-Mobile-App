# Streamstein mobile — port plan

**Goal (set 2026-11-15):** the mobile app is a *shrunk-down port of the desktop StreamStein app* —
same streaming sources, same local library, same settings. It is **not** a Readstein-style
spiral-search app; the radial search belonged to Readstein.

## The architecture that makes this a port, not a rewrite

The desktop app is Electron (main process in `index.js` + `src/ipc/*`) with a **React renderer**
(`src/pages/*`, `src/components/*`) built by Vite. The mobile app already uses Vite + React 19.

So the renderer is reusable. What stands between the two is **155 IPC methods** exposed on
`window.electron` by the desktop `preload.js`. The port therefore hinges on one thing:

> A `window.electron` **shim** backed by Tauri `invoke`, so desktop pages drop in unchanged.

`src/platform/bridge.ts` is that shim. It installs itself before the app renders and routes each
method to a Tauri command; in a browser (vite dev without the native shell) it falls back to
stubs so the UI still runs for layout work.

This means the porting loop per page is: copy the page -> fix imports -> replace Electron-only
APIs that have no mobile equivalent -> make the layout responsive.

## What genuinely ports, and what cannot

| Area | Verdict |
| --- | --- |
| Pages, components, styles, theming | **Port** — React for React; needs responsive passes for a phone |
| Settings, storage, library paths | **Port** — reimplemented as a Tauri store command |
| Local video library (scan folder, tiles, playback) | **Port** — local file access via the Tauri fs plugin |
| Streaming from the provider sources | **Port with new plumbing** — embed URLs load in a webview, but Electron's `webRequest` interception does not exist in Tauri, so stream-URL capture moves to Rust |
| Downloads (yt-dlp / ffmpeg) | **Not available on Android** — those binaries are desktop-only. Deferred, not faked |
| Chromecast, PiP, auto-update, yt-bridge, the YouTube downloader extension | **Desktop-only** — the mobile app links to no equivalent |

The 155 methods split roughly: ~40 matter on mobile, ~60 are settings/state that port cheaply,
and ~55 are desktop-only (updates, cast, PiP, bridge, downloader tooling) and get removed.

## Phases

**P1 — foundation (in progress).** The bridge shim, a settings store that persists, the mobile
navigation shell, and the app's design tokens so it looks like Streamstein on a phone.

**P2 — local library.** Storage permission, folder scan, video tiles, playback of local files,
and details/continue-watching — the "view local files the same way" half of the goal.

**P3 — streaming.** The provider registry ported from `src/utils/api.js`, an in-app webview
player, and stream-URL capture in Rust (the piece that replaces `webRequest`).

**P4 — parity polish.** Search, filters, per-channel behaviour, the settings surface, gestures
and tablet layout — then a responsive pass at phone width for every page.

## Ground rules

- **One source of truth for the provider registry.** The desktop ships it in four places
  (`api.js`, `downloads.js`, `streamResolver.js`, `tvSeriesPlayerDownload.js`). Mobile should
  have exactly one, or the two apps will drift apart.
- **Never fake a capability.** If something cannot work on Android, it is removed from the UI
  rather than shown broken.
- **Keep the desktop renderer diff-able.** Prefer adapting the shim over editing ported pages,
  so future desktop changes remain portable.
- Verify on device: a change that only builds is not done (see `docs/MOBILE-BUILD.md`).
