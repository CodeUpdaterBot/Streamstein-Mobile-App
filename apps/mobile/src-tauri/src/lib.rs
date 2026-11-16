// Streamstein mobile — native side.
//
// Scope (set 2026-11-15): a local content app. Scan the folders the user copied media into,
// hand the library to the UI, and remember the chosen folder. No streaming, no downloading —
// yt-dlp/ffmpeg cannot exist on Android and pretending otherwise would be dishonest.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

const VIDEO_EXTS: [&str; 9] = ["mp4", "mkv", "webm", "m4v", "mov", "avi", "mpg", "mpeg", "ts"];
const SUB_EXTS: [&str; 4] = ["vtt", "srt", "ass", "ssa"];

/// How deep to walk. Deep enough for `channel/season/episode.mp4`, shallow enough that a stray
/// symlink loop or an enormous tree cannot hang the scan.
const MAX_DEPTH: usize = 6;
/// Ceiling on returned entries; the UI reports truncation rather than the scan running on.
const MAX_ENTRIES: usize = 20_000;

#[derive(Serialize)]
pub struct VideoEntry {
    path: String,
    name: String,
    title: String,
    dir: String,
    ext: String,
    size_bytes: u64,
    modified_ms: Option<u64>,
    /// Sibling transcript, using the desktop app's <basename>.vtt/.srt convention.
    transcript: Option<String>,
    /// Sibling comment sidecar, matching the desktop's <basename>.comments.json.
    comments: Option<String>,
}

#[derive(Serialize)]
pub struct ScanResult {
    root: String,
    videos: Vec<VideoEntry>,
    total: usize,
    truncated: bool,
    /// True when the folder exists but could not be read — on Android the usual cause is a
    /// missing "All files access" grant, so the UI must be able to say that specifically.
    unreadable: bool,
}

#[derive(Serialize)]
pub struct CandidateRoot {
    path: String,
    video_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Settings {
    library_root: Option<String>,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {dir:?}: {e}"))?;
    Ok(dir.join("settings.json"))
}

fn read_settings(app: &tauri::AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn lower_ext(p: &Path) -> String {
    p.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Look for sibling transcript/sidecars. Both the desktop app and the downloader extension
/// write these beside the media using the media's own basename, so the phone can reuse them.
fn sidecars(video_path: &Path) -> (Option<String>, Option<String>) {
    let parent = match video_path.parent() {
        Some(p) => p,
        None => return (None, None),
    };
    let stem = match video_path.file_stem() {
        Some(s) => s.to_string_lossy().to_string(),
        None => return (None, None),
    };

    let mut transcript = None;
    for ext in SUB_EXTS {
        let cand = parent.join(format!("{stem}.{ext}"));
        if cand.is_file() {
            transcript = Some(cand.to_string_lossy().to_string());
            break;
        }
    }

    let comments = parent.join(format!("{stem}.comments.json"));
    let comments = if comments.is_file() {
        Some(comments.to_string_lossy().to_string())
    } else {
        None
    };

    (transcript, comments)
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<VideoEntry>) {
    if depth > MAX_DEPTH || out.len() >= MAX_ENTRIES {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_ENTRIES {
            return;
        }
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            // Hidden dirs and Android's internal tree are never the user's content.
            if name.starts_with('.') || name == "Android" {
                continue;
            }
            walk(&path, depth + 1, out);
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        let ext = lower_ext(&path);
        if !VIDEO_EXTS.contains(&ext.as_str()) {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let title = path
            .file_stem()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| name.clone());
        let (transcript, comments) = sidecars(&path);
        out.push(VideoEntry {
            path: path.to_string_lossy().to_string(),
            name,
            title,
            dir: path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            ext,
            size_bytes: meta.len(),
            modified_ms: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64),
            transcript,
            comments,
        });
    }
}

#[tauri::command]
fn scan_videos(root: String) -> ScanResult {
    let dir = PathBuf::from(&root);
    let mut videos = Vec::new();
    let unreadable = !dir.is_dir() || std::fs::read_dir(&dir).is_err();
    if !unreadable {
        walk(&dir, 0, &mut videos);
    }
    // Newest first: content just copied over is what the user is looking for.
    videos.sort_by(|a, b| b.modified_ms.unwrap_or(0).cmp(&a.modified_ms.unwrap_or(0)));
    let total = videos.len();
    ScanResult {
        root,
        videos,
        total,
        truncated: total >= MAX_ENTRIES,
        unreadable,
    }
}

/// Likely media folders on this device. Android aliases the internal volume as both `/sdcard`
/// and `/storage/emulated/0`; removable SD cards appear as `/storage/XXXX-XXXX`, which is where
/// content often actually lives. iOS keeps media under its own tree.
fn platform_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "ios")]
    {
        for base in ["/var/mobile/Media", "/private/var/mobile/Media"] {
            for sub in ["DCIM", "DCIM/Camera", "Movies", "Downloads", ""] {
                let p = if sub.is_empty() {
                    PathBuf::from(base)
                } else {
                    PathBuf::from(base).join(sub)
                };
                roots.push(p);
            }
        }
        return roots;
    }

    #[allow(clippy::needless_range_loop)]
    let subs = [
        "Movies",
        "Download",
        "Downloads",
        "DCIM",
        "DCIM/Camera",
        "Pictures",
        "Documents",
        "Videos",
        "Recordings",
        "WhatsApp/Media",
        "WhatsApp/Media/WhatsApp Video",
        "Telegram",
        "Telegram/Telegram Video",
        "Snapchat",
    ];

    for base in ["/sdcard", "/storage/emulated/0"] {
        for sub in subs {
            roots.push(PathBuf::from(base).join(sub));
        }
    }

    // Removable volumes: a real gap in the first version — content is often copied to an SD card.
    if let Ok(entries) = std::fs::read_dir("/storage") {
        for entry in entries.flatten() {
            let volume = entry.path();
            let name = volume
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if name == "emulated" || name == "self" || name.starts_with('.') {
                continue;
            }
            for sub in ["Movies", "Download", "DCIM", "Videos", "Pictures"] {
                roots.push(volume.join(sub));
            }
        }
    }

    roots
}

/// What the app can actually see. Exists to turn a silent "no videos" into a specific
/// explanation: on Android the usual cause is a missing "All files access" grant, and the user
/// cannot act on that if the app never says it.
#[derive(Serialize)]
pub struct RootDiagnosis {
    path: String,
    exists: bool,
    readable: bool,
    video_count: usize,
}

#[derive(Serialize)]
pub struct StorageDiagnosis {
    /// False when even the top of the shared storage cannot be listed — the permission signal.
    can_list_shared_storage: bool,
    roots: Vec<RootDiagnosis>,
    candidate_count: usize,
}

#[tauri::command]
fn storage_diagnosis() -> StorageDiagnosis {
    let shared = PathBuf::from("/storage/emulated/0");
    let can_list_shared_storage = cfg!(not(target_os = "android"))
        || std::fs::read_dir(&shared)
            .map(|mut it| it.next().is_some())
            .unwrap_or(false);

    let mut roots = Vec::new();
    for root in platform_roots() {
        if !root.exists() {
            continue;
        }
        let readable = std::fs::read_dir(&root).is_ok();
        let mut videos = Vec::new();
        if readable {
            walk(&root, 0, &mut videos);
        }
        roots.push(RootDiagnosis {
            path: root.to_string_lossy().to_string(),
            exists: true,
            readable,
            video_count: videos.len(),
        });
    }
    roots.sort_by(|a, b| b.video_count.cmp(&a.video_count));
    let candidate_count = roots.iter().filter(|r| r.video_count > 0).count();
    StorageDiagnosis {
        can_list_shared_storage,
        roots,
        candidate_count,
    }
}

/// Folders that actually hold videos, so first launch can suggest somewhere useful instead of
/// asking the user to type a filesystem path.
#[tauri::command]
fn candidate_roots(app: tauri::AppHandle) -> Vec<CandidateRoot> {
    let mut roots = platform_roots();
    if let Ok(dir) = app.path().app_data_dir() {
        roots.push(dir);
    }

    let mut out = Vec::new();
    for root in roots {
        if !root.is_dir() {
            continue;
        }
        let mut videos = Vec::new();
        walk(&root, 0, &mut videos);
        if videos.is_empty() {
            continue;
        }
        out.push(CandidateRoot {
            path: root.to_string_lossy().to_string(),
            video_count: videos.len(),
        });
    }
    out.sort_by(|a, b| b.video_count.cmp(&a.video_count));
    out
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Settings {
    read_settings(&app)
}

#[tauri::command]
fn set_library_root(app: tauri::AppHandle, root: String) -> Result<Settings, String> {
    let settings = Settings {
        library_root: Some(root),
    };
    let path = settings_path(&app)?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("cannot write {path:?}: {e}"))?;
    Ok(settings)
}

#[tauri::command]
fn native_info() -> serde_json::Value {
    serde_json::json!({
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "version": env!("CARGO_PKG_VERSION"),
    })
}

// ── MediaStore (Android's own media index) ─────────────────────────────────────────────────
// Implemented in Kotlin (MediaStorePlugin.kt) because that is where Android's content resolver
// and runtime permissions live. A Tauri plugin handle is only obtainable in the plugin's own
// `setup` hook, so it is captured there and parked in managed state for the commands to use —
// `app.plugin(name)` is NOT that API (it registers a plugin, it does not look one up).

const MEDIASTORE_PLUGIN: &str = "mediastore";
const MEDIASTORE_CLASS: &str = "MediaStorePlugin";
const MEDIASTORE_IDENTIFIER: &str = "com.streamstein.app";

#[derive(Default)]
struct MediaStoreState<R: tauri::Runtime>(Mutex<Option<tauri::plugin::PluginHandle<R>>>);

fn mediastore_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new(MEDIASTORE_PLUGIN)
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin(MEDIASTORE_IDENTIFIER, MEDIASTORE_CLASS)?;
                app.manage(MediaStoreState::<R>(Mutex::new(Some(handle))));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}

/// Calls one of the Kotlin plugin's @Command methods.
#[cfg(target_os = "android")]
fn call_mediastore<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    method: &str,
) -> Result<serde_json::Value, String> {
    call_mediastore_with(app, method, serde_json::json!({}))
}

#[cfg(target_os = "android")]
fn call_mediastore_with<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    method: &str,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let state = app.state::<MediaStoreState<R>>();
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let handle = guard
        .as_ref()
        .ok_or_else(|| "mediastore plugin not available".to_string())?;
    handle
        .run_mobile_plugin::<serde_json::Value>(method, payload)
        .map_err(|e| format!("{e}"))
}

/// Android-only. Opens the video in the device's own player — the escape hatch for codecs the
/// in-app WebView player cannot decode.
#[tauri::command]
async fn mediastore_open_player<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    uri: String,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        call_mediastore_with(&app, "openInSystemPlayer", serde_json::json!({ "uri": uri }))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, uri);
        Err("The system player is Android-only".to_string())
    }
}

/// Android-only. On other platforms the caller falls back to scanning folders directly.
#[tauri::command]
async fn mediastore_access<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        call_mediastore(&app, "access")
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("MediaStore is Android-only".to_string())
    }
}

/// Android-only. Triggers the one-tap runtime permission dialog.
#[tauri::command]
async fn mediastore_request_access<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        call_mediastore(&app, "requestAccess")
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("MediaStore is Android-only".to_string())
    }
}

/// Every video the device's media scanner knows about, newest first, as content:// URIs.
#[tauri::command]
async fn mediastore_videos<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        call_mediastore(&app, "queryVideos")
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("MediaStore is Android-only".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(mediastore_plugin())
        .invoke_handler(tauri::generate_handler![
            native_info,
            scan_videos,
            candidate_roots,
            storage_diagnosis,
            get_settings,
            set_library_root,
            mediastore_access,
            mediastore_request_access,
            mediastore_videos,
            mediastore_open_player
        ])
        .run(tauri::generate_context!())
        .expect("error while running Streamstein");
}
