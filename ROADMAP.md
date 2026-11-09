# Streamstein Mobile — roadmap

Status: **phase 0 done (scaffold)**. Two decisions block phase 1 — see the bottom.

## Phase 0 — grounding (done)

- [x] Read the live Readstein search/index/dial sources; write down the contract
- [x] Read the live StreamStein desktop catalog + transcript handling
- [x] Fix the mapping in `docs/SPIRAL-SEARCH-COMPATIBILITY.md`
- [x] Encode it in `schema/streamstein-media.schema.json`
- [x] Register the project in `C:\Users\PC\Hermes-Control\app-control-map.json`

## Phase 1 — a real, runnable skeleton

- [x] **`packages/search-core`**: folding with an offset map, VTT/SRT parsing, cue
      chunking into sections with cue spans, streaming `searchWorks()` generator,
      cue-level locator resolution — 21 tests, all passing (`npm test` in the package)
- [ ] Decide the code base (fork Readstein monorepo vs. slim Tauri app sharing schema)
- [ ] Video library store: `Media/<hash>/` with `meta.json`, `cover.*`, `search.db`
- [ ] Transcript ingestion wired to the real catalog (`transcriptPath` → parse → index)
- [ ] Tile grid ("video tiles") over the catalog, with the same status/filter vocabulary
- [ ] One end-to-end proof in the app shell: index a real transcript, query it, get a
      `tMs` seek target, and seek the player to it

## Phase 2 — the dial

- [ ] `SpiralSearchView` port: hub = query, ring 1 = year bands, ring 2 = works in the
      selected year, panel = matched passages (with mm:ss instead of page numbers)
- [ ] `publishedAt` acquisition so the year ring is meaningful for videos
- [ ] "Components, not works": chapters as dated/components
- [ ] `YearGap` analysis as the separate "what to acquire next" surface

## Phase 3 — Readstein interop

- [ ] Pick the interop route (shared on-disk index / shared package / query bridge)
- [ ] Prove one query returns books *and* videos in one dial, with the same folding
- [ ] Keep `SEARCH_INDEX_VERSION` and folding in one place, versioned

## Phase 4 — mobile shell

- [ ] Android build path from Readstein's `dev-android`; iOS later
- [ ] Player + transcript reader (cue list synced to playback, tap-to-seek)
- [ ] Offline library, thumbnail cache, background/foreground index rebuild

## Open decisions (need the user)

1. **GitHub repo** — create `CodeUpdaterBot/Streamstein-Mobile-App` (private)? Repo
   creation is public-facing; not done without approval.
2. **Code base** — derive from the Readstein monorepo (inherits Tauri+Next, mobile
   scripts, and the search code, but drags along the whole reader) or start a slimmer
   app that depends only on the shared schema? Everything else in phase 1 is the same
   work either way.
3. **Schema ownership** — Readstein owns it and Streamstein tracks it, or Streamstein
   owns the shared media schema outright?
4. **Library root on mobile** — a local `Media/<hash>/` copy, or a read-only view of
   what the desktop app already downloaded?
