// Streamstein mobile native entry point.
//
// Stage 1 exposes `native_info` only: enough for the front-end to prove it can talk to the
// native side on a real device, which is the thing worth verifying before any UI work.

use serde::Serialize;

#[derive(Serialize)]
pub struct NativeInfo {
    platform: String,
    arch: String,
    version: String,
    executable: Option<String>,
}

#[tauri::command]
fn native_info() -> NativeInfo {
    NativeInfo {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        executable: std::env::current_exe()
            .ok()
            .map(|p| p.to_string_lossy().to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![native_info])
        .run(tauri::generate_context!())
        .expect("error while running Streamstein");
}
