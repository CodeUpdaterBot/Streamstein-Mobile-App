# Streamstein Mobile App — managed project runbook

## Identity

- Project name: Streamstein Mobile App
- Managed path: `C:/Users/PC/Documents/Coding Projects/Streamstein-Mobile-App`
- GitHub repo: *not created yet* — proposed `CodeUpdaterBot/Streamstein-Mobile-App`
  (sibling naming with `CodeUpdaterBot/Hermes-Mobile-App`). Do not create without
  explicit approval: repo creation is an external, public-facing side effect.
- Visibility once created: private until the user says otherwise.
- Git identity for commits in this repo: `Steven <runcomps@gmail.com>` (required so
  Vercel recognises contributor access if a website/branch is later deployed).
- Related repos: `CodeUpdaterBot/StreamStein` (desktop), `CodeUpdaterBot/StreamStein_WEBSITE`
  (site), `CodeUpdaterBot/Readstein` (reader, schema owner).

## Scope

The mobile app only. Keep the desktop app, the website, and Readstein out of this
repository — reference them by path, never copy their build output across.

## Do not commit

- `node_modules/`, package-manager caches
- Rust/Tauri `target/` outputs, `.next/`, `dist/`, `build/`, `.vercel/`
- `.env*` except example files
- mobile signing material / keystores / certificates
- generated Android `jniLibs`, iOS `Pods`/derived data
- media files: video (`mp4/mkv/webm/m4v/avi/mov`), transcripts
  (`vtt/srt/ass/ssa`), `youtube-catalog.json`, cover/thumbnail caches

Test fixtures are the exception: small, explicit, in `fixtures/`, named as fixtures.

## Tooling (inherited from Readstein unless a decision changes it)

- Package manager: `pnpm` (Readstein monorepo declares `pnpm@11.1.1`; root
  `package.json` + `pnpm-workspace.yaml`).
- App shell: Tauri v2 + Next.js (Readstein ships `src-tauri`, plus
  `dev-android` / `build-ios` scripts) — the mobile build path already exists there.
- Checks before claiming anything works: install, typecheck/lint, the narrowest
  relevant test, and a real build. Record the exact commands and their real output.

## Workflow

1. Inspect the relevant package before changing anything; this app's behaviour must
   stay compatible with the schema, not with a memory of the schema.
2. Run the narrowest available check first, then widen. Never report a feature as
   working without the command output that proves it.
3. Commit with the repo-local identity above; direct-to-main is the house default.

## Verification log

| Date | Action | Evidence |
| --- | --- | --- |
| 2026-10-19 | Scaffold created (README, runbook, schema, roadmap) from live Readstein + StreamStein sources | Source facts in `reference/` carry `file:line` provenance |
