# Spiral search compatibility: Readstein ⇄ Streamstein

**The requirement:** a spiral search must work across videos *and* their VTT
transcripts — and across Readstein's books too, when both libraries are visible.

Everything marked **[verified]** was read out of the live sources on 2026-10-19 and
carries `file:line` provenance in [`../reference/upstream-facts.md`](../reference/upstream-facts.md).
Everything marked **[proposed]** is a design decision that still needs the user's
sign-off.

---

## 1. How Readstein actually does it [verified]

**Work identity**

| Field | Meaning | Source |
| --- | --- | --- |
| `hash` | partial md5 of the file — the unique id, and the on-disk directory name | `types/book.ts:Book.hash` |
| `metaHash` | metadata md5 — aggregates *different versions of the same work* | `types/book.ts:Book.metaHash` |
| `format` | `EPUB \| PDF \| MOBI \| AZW \| AZW3 \| CBZ \| FB2 \| FBZ \| TXT \| MD \| ABS` | `types/book.ts:BookFormat` |
| `title` / `sourceTitle` / `author` | editable title vs. the name parsed at import vs. author | `types/book.ts` |
| `groupId` / `groupName` / `tags` | shelf/collection grouping | `types/book.ts` |

**Text index — the part that must match**

`<Books>/<hash>/search.db` sits beside `cover.png` and holds the section text;
`SEARCH_INDEX_VERSION` is bumped whenever extraction or folding changes so stale
caches rebuild. [verified — `services/librarySearchIndex.ts:15`]

```ts
// services/librarySearchIndex.ts
interface SearchIndexMeta   { updatedAt: number; version: number; totalSections: number; complete: boolean; navHash: string }
interface SearchIndexSection{ idx: number; label: string; text: string }
```

- `navHash` tracks TOC freshness separately from `(updatedAt, version)` because the
  TOC can change (`nav.json` enrichment) without the file changing.
- Folding is *maximal*: caseless + diacriticless (`FOLD_OPTIONS`), used as a **LIKE
  superset prefilter**; the real matcher on the original text stays the final arbiter
  of matches and offsets. [verified — `services/librarySearchIndex.ts:22`]

**Search config & results**

```ts
// types/book.ts:543
type LibrarySearchConfig = Omit<BookSearchConfig,'mode'> & { mode: SearchMode | 'fuzzy'; /* + English-only filter */ }
type LibrarySearchTarget = 'books' | 'text'          // shelf search vs full-text
interface SearchExcerpt  { pre: string; match: string; post: string }
interface LibrarySearchMatch        { locator: SearchResultLocator; excerpt: SearchExcerpt }
interface LibrarySearchSectionResult{ index: number; label: string; subitems: LibrarySearchMatch[] }
```

- Streaming, not batch: `searchLibraryBooks()` is an **async generator** that emits
  events as it scans, so the dial fills out live. [verified — `services/librarySearchService.ts:459`]
- A result's location is a **CFI** resolved separately
  (`resolveSearchResultCfi`), i.e. *match → stable locator → seek target* is already
  a three-step pipeline. [verified — `services/librarySearchService.ts:878-938`]
- Whole-word matching is derived from the legacy boolean when `mode` is absent
  (`ensureSearchMode`). [verified — `utils/searchConfig.ts`]

**The dial (year rings)**

```ts
// app/library/utils/yearBands.ts
interface DatedWork { book: Book; year: number; endYear: number; label: string; part: string }
interface YearBand  { lo: number; hi: number; label: string; works: DatedWork[] }
```

- Bands are a **fixed step in years**, not wherever the data falls: "slicing wherever
  the data happens to fall … puts a ten-year tile beside a single-year tile … and the
  ring then reads as though the sort order wandered."
- The dial plots **components, not works** — a composite work with three dated parts
  occupies three places on the ring. `YearGap` (empty stretches) is deliberately
  *not* on the dial; it is the "what do I acquire next?" analysis.
- `DEFAULT_MIN_GAP_YEARS = 20`; years are signed (negative = BCE). [verified — `yearBands.ts`]
- `SpiralSearchView` reuses `searchLibraryBooks` unchanged — the dial is a *view* of
  the same search, never a second search implementation. [verified — `app/library/components/SpiralSearchView.tsx:1-70`]

## 2. What StreamStein already has [verified]

**Desktop catalog** — `youtube-catalog.json`, written by the yt-saver bridge and the
desktop app, mirrored into the bridge root:

```jsonc
{ "version": 1, "schema": "yt-saver-youtube-catalog", "updatedAt": "…", "records": [ … ] }
```

Record fields the library surface reads [`src/ipc/youtubeLibrary.js:150-199`]:
`id, videoId, title, channelName, libraryChannel, youtubeChannelName, channelKey,
channelId, watchUrl, shortUrl, thumbnailUrl, filePath, fileName, directory, extension,
size, mtime, completedAt, quality, source, durationSeconds, metadataTestClone,
metadataTestSourceId, transcriptPath, fileExists, canPlayInApp`

- Only `status === "completed" && assetType === "video"` records with a real video
  file become library tiles.
- **Transcripts already exist as a first-class concept**: `.vtt/.srt/.ass/.ssa`
  (`TRANSCRIPT_EXTS`), found by a directory+basename key
  (`${dir}::${stripWindowsDuplicateBasename(basename)}`) and attached to the video as
  `transcriptPath`. [verified — `youtubeCatalogScan.js:13`, `youtubeLibrary.js:158-163`]
- `VIDEO_EXTS = .mp4 .mkv .webm .m4v .avi .mov`; in-app play is narrower
  (`IN_APP_PLAY_EXTS = .mp4 .m4v`). [verified — `youtubeLibrary.js:23-24`]
- Subtitle acquisition (SubDL + Wyzie, zip extraction incl. `.vtt`) lives in
  `src/ipc/subtitles.js`. [verified]

## 3. The mapping [proposed, except where noted]

| Readstein concept | Streamstein equivalent | Note |
| --- | --- | --- |
| `Book` | `MediaItem` | one video file, or one streamable episode |
| `BookFormat` | `MediaFormat`: `MP4 \| MKV \| WEBM \| M4V \| AVI \| MOV \| HLS` | first six **[verified]** from `VIDEO_EXTS`; `HLS` proposed for streams |
| `hash` (partial md5 of file) | `hash` — partial md5 of the **video** file | same algorithm, keeps one identity scheme |
| `metaHash` | `metaHash` — video + its transcript | groups re-encodes/qualities and re-downloads of one work **[proposed]** |
| `author` | `channelName` (creator), with `libraryChannel` as the shelf grouping | both fields already exist in the catalog |
| `groupId`/`groupName`/`tags` | series/playlist/channel id + tags | `seriesId`/`playlistId` proposed |
| `title`/`sourceTitle` | `title` / `fileName`-derived fallback | already how the desktop app falls back |
| `search.db` sections | **transcript cues, chunked** | see below |
| `SearchIndexSection.label` | chapter title (YouTube chapters) or `mm:ss` of the cue's start | |
| `SearchIndexSection.text` | the cue text of that chunk, joined and normalized | |
| `SearchIndexMeta.navHash` | hash of the chapter list / transcript revision | keeps "did the structure change?" separate from "did the text change?" |
| `SearchResultLocator` (CFI) | **`cursor`**: `{ sectionIdx, cueIdx, tMs }` → seek position | the video analogue of a CFI, and it must be stable across re-index |
| `LibrarySearchTarget` | `'works' \| 'transcripts'` (`'books' \| 'text'` today) | names change, semantics don't |
| matches/year for the dial | `year` from `publishedAt` (fallback: `completedAt`, then file mtime) | **[proposed]** — the catalog has no published date today, so acquiring it is a task |
| `part` on `DatedWork` | the chapter/section within the video | mirrors "components, not works" |

### The one thing that does *not* carry over

Readstein's excerpt→CFI step exists because an EPUB position is a string. A video
position is a **time**, so the locator is `{sectionIdx, cueIdx, tMs}` and the
"resolve" step becomes "map index positions to the seek target" — the shape of the
pipeline is preserved, the payload is not.

**Resolve to the cue, not the section.** A section is a chunk of up to ~700
characters of transcript; its start time can be a minute from the passage that
matched. So each section carries `cueSpans` (each cue's offsets inside the section
text) and a match resolves to *the cue that speaks it*: `tMs` is that cue's start
time. It is deliberately **not** interpolated into the middle of the cue — a
proportional guess would look precise without being right. Implemented and covered
by tests in `packages/search-core` (`test/search.test.ts`, "the locator seeks into
the RIGHT cue").

## 4. Cross-app search: how one dial sees both libraries [proposed]

Three viable routes; pick one before writing index code.

1. **Shared on-disk index format.** Both apps write the same `search.db` tables
   (`meta`, `sections`) under their own work directories, and a search session can
   open a list of *index roots* — Readstein's `Books/<hash>/` and Streamstein's
   `Media/<hash>/`. One matcher, one folding implementation, two roots. Lowest
   divergence risk, requires the schema to be versioned in one place.
2. **Shared index package.** Extract Readstein's `librarySearchIndex` +
   `librarySearchService` + `containsSearch`/`fuzzySearch` folding into a versioned
   package both apps depend on. Cleanest long-term, biggest refactor on the Readstein
   side.
3. **Interop only at the query layer.** Each app indexes its own library; a thin
   bridge exposes one app's results to the other. Fastest, but the two matchers drift
   and "the same query" stops meaning the same thing.

Recommendation: **(1) now, (2) later** — start by making the index format a versioned
artifact both sides agree on, then extract the code once the format has stopped
moving.

### Non-negotiables for any route

- **Same folding.** Caseless + diacriticless as a superset prefilter, real matcher on
  the original text as final arbiter. A different fold = different results = the dial
  lies.
- **Same mode names.** `contains` / `whole-words` / `fuzzy` (plus case/diacritics
  toggles) must mean identical things on both sides, and `LibrarySearchConfig`'s
  legacy-boolean derivation must be replicated exactly.
- **Streaming.** Results arrive as an async generator so the dial fills live; no
  implementation may block until the whole library is scanned.
- **Versioned index.** Bump on any extraction/folding change; stale caches rebuild.
- **Signed years, fixed-width bands.** Keep `DEFAULT_MIN_GAP_YEARS = 20` and the
  "components, not works" rule or the dial's ring reads wrong.

## 5. Open questions for the user

1. Does Streamstein Mobile *own* the shared schema, or does Readstein stay the owner
   and Streamstein track it? (Ownership decides where the version constant lives.)
2. Do the two libraries live side by side on one device, or is cross-app search only
   ever a merged view in one of them?
3. Where does the video library root go on mobile — a copied `Media/<hash>/`
   directory like Readstein's `Books/<hash>/`, or a read-only view of files the
   desktop app already downloaded?
4. Is `publishedAt` worth acquiring (YouTube API / TMDB) purely to make the year ring
   meaningful for videos, given the desktop catalog does not carry it today?
