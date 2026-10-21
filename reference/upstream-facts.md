# Upstream facts (read 2026-10-19, with provenance)

Every claim in `docs/SPIRAL-SEARCH-COMPATIBILITY.md` marked **[verified]** traces to
one of these reads. Re-verify against the live files before relying on any of it;
these repos move.

## Readstein — `C:/Users/PC/Documents/Coding Projects/Readstein`

Root `package.json`: `@readest/monorepo`, private, `packageManager: pnpm@11.1.1`,
biome 2.4.9, patched dep `@assistant-ui/react@0.11.58` (fix in `patches/`).

`apps/`: `readest-app` (Next.js + Tauri v2, `@readest/readest-app@0.12.2`),
`readstein-app`, `readest.koplugin`, `readest-calibre-plugin`.
`packages/`: `foliate-js`, `js-mdict`, `simplecc-wasm`, `swift-rs`, `tao`, `tauri`,
`tauri-plugins`, `turso_ext`.

Mobile build path already present in `apps/readest-app/package.json`:
`dev-android` (`tauri android build -t aarch64` + `adb install`),
`dev-ios`, `dev-ios-sim`, `release-google-play`, `submit-appstore-*`.

- `apps/readest-app/src/types/book.ts:16` — `BookFormat` union; `:543` —
  `LibrarySearchConfig` / `LibrarySearchTarget`; `:555,581,586` —
  `SearchExcerpt` / `LibrarySearchMatch` / `LibrarySearchSectionResult`.
- `apps/readest-app/src/services/librarySearchIndex.ts:15` — `SEARCH_INDEX_VERSION = 1`;
  path doc-comment: per-book `<Books>/<hash>/search.db` beside `cover.png`;
  `:22` — `FOLD_OPTIONS = { matchCase: false, matchDiacritics: false }`;
  `:26-38` — `SearchIndexMeta`, `SearchIndexSection`.
- `apps/readest-app/src/services/librarySearchService.ts:459` — `searchLibraryBooks`
  async generator; `:878,884,938` — `ResolvedSearchResultCfi`, `resolveSearchResultCfis`,
  `resolveSearchResultCfi`.
- `apps/readest-app/src/utils/searchConfig.ts` — `DEFAULT_NEARBY_WORDS = 10`,
  `modeToWholeWords`, `ensureSearchMode`.
- `apps/readest-app/src/app/library/components/SpiralSearchView.tsx:1-70` — dial
  doc-comment; reuses `searchLibraryBooks`; props include `onSelectResult(book, cfi)`.
- `apps/readest-app/src/app/library/utils/yearBands.ts` — `DatedWork`, `YearBand`,
  `YearGap`, fixed-step rationale, `DEFAULT_MIN_GAP_YEARS = 20`, signed years.
- Runbook: `Readstein/AGENTS.md` (private repo; identity `Steven <runcomps@gmail.com>`).

## StreamStein desktop — `C:/Users/PC/Documents/Coding Projects/StreamStein`

`package.json`: `streamstein@2.5.0`, Electron + Vite, scripts incl.
`test:media-playback`, `enrich-youtube-catalog`, `dist:win|linux|mac`.

- `src/ipc/youtubeLibrary.js:12-13` — reads `youtube-catalog.json` maintained by the
  yt-saver bridge; `:23-24` —
  `VIDEO_EXTS = .mp4 .mkv .webm .m4v .avi .mov`, `IN_APP_PLAY_EXTS = .mp4 .m4v`;
  `:150-199` — the library projection (fields listed in the compat doc), transcript
  attach via `${dir}::${stripWindowsDuplicateBasename(basename)}`; `:203` —
  `SUBTITLE_EXTS`.
- `src/ipc/youtubeCatalogScan.js:13` — `TRANSCRIPT_EXTS`; `:15-16` —
  `CATALOG_VERSION = 1`, `CATALOG_SCHEMA = "yt-saver-youtube-catalog"`; catalog shape
  `{version, schema, updatedAt, records[]}`, mirrored to the bridge root.
- `src/ipc/subtitles.js:3-5` — SubDL + Wyzie subtitle search, ZIP extraction
  (`srt|vtt|ass|ssa`), registry in the downloads store.
- `scripts/enrich-youtube-catalog.js` — thin CLI wrapper over
  `src/ipc/runYoutubeCatalogEnrich.js`.

## Control plane — `C:/Users/PC/Hermes-Control`

`app-control-map.json` (57 entries) already records, for the sibling projects:
Readstein (`C:/Users/PC/Documents/Coding Projects/Readstein`,
`CodeUpdaterBot/Readstein`, seed `C:/Users/PC/Downloads/readest-main`),
StreamStein desktop (`CodeUpdaterBot/StreamStein`, public, build
`node node_modules/vite/bin/vite.js build`, test `npm run test:media-playback`), and
StreamStein Website (`CodeUpdaterBot/StreamStein_WEBSITE`,
`prj_qQAlq3yloGLDuvOslFKoaWYYda30`, https://www.streamstein.com).

`github-repos.json`: `CodeUpdaterBot/StreamStein` — public, JavaScript, home
https://www.streamstein.com/ (as of 2026-09-07). Also present: `streambert` (public
Electron app) and `vid-dl-cli-only` (public, CLI builds for truelockmc/video-downloader).
