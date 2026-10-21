# Streamstein Mobile App

Video-first sibling of the **Readstein** reader app. Same library/tile/spiral-search
architecture, same metadata philosophy — but the things in the library are videos,
not books, and the text you can search inside is their **transcript (`.vtt` / `.srt`)**
instead of their prose.

## Why this repo exists separately

| Project | Path | Role |
| --- | --- | --- |
| **Streamstein Mobile App** (this repo) | `C:/Users/PC/Documents/Coding Projects/Streamstein-Mobile-App` | The mobile app: video library, player, transcript reader, spiral search |
| **StreamStein** (desktop, Electron) | `C:/Users/PC/Documents/Coding Projects/StreamStein` | Existing desktop app: downloader, local library, player, subtitle registry |
| **StreamStein_WEBSITE** | `C:/Users/PC/Documents/Coding Projects/StreamStein_WEBSITE` | Landing page, https://www.streamstein.com |
| **Readstein** (readest fork) | `C:/Users/PC/Documents/Coding Projects/Readstein` | The reader app this one is modelled on; owner of the book-side schema |

Streamstein Mobile must **not** fork-read the desktop app's runtime; it consumes the
same *data* (the `youtube-catalog.json` catalog and the media/subtitle files on disk)
and shares the *search schema* with Readstein so one spiral search can walk books,
videos and transcripts together.

## The one hard requirement

> A spiral search must work across **videos and their transcripts** — and, where the
> libraries are visible to each other, across **Readstein's books** too.

That requirement is a schema requirement, not a UI requirement. It is written down in
[`docs/SPIRAL-SEARCH-COMPATIBILITY.md`](docs/SPIRAL-SEARCH-COMPATIBILITY.md) and
encoded in [`schema/`](schema/) — read those before writing any index or search code.

## Status

`started_local_scaffold` — schema + runbook + roadmap captured from the real
Readstein and StreamStein sources. No application code yet. See
[`ROADMAP.md`](ROADMAP.md) for the phase plan and the two decisions still open
(GitHub repo creation, and whether this derives from the Readstein monorepo or
starts as a slimmer Tauri app that shares only the schema).

## Layout

```
docs/    design notes — spiral-search compatibility, upstream findings
schema/  JSON Schema for the shared media/transcript/spiral metadata
reference/  extracted facts from the sibling repos, with file:line provenance
```
