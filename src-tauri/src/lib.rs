/**
 * M4TR1X - Tauri Main Library
 *
 * Manages the app lifecycle:
 *  - On desktop:  spawns the Express/Node.js server before the window opens
 *  - On mobile:   skips the server (frontend uses Nostr relays directly)
 *  - All platforms: exposes IPC commands to the frontend via invoke()
 *
 * Security model (mirrors the old Electron setup):
 *  - CSP enforced in tauri.conf.json
 *  - IPC uses Tauri's capability system (capabilities/default.json)
 *  - External links open in system browser, never in-app
 */

mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── Plugins ──────────────────────────────────────────────────────────
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        // ── IPC commands (replaces Electron's preload.js bridge) ─────────────
        .invoke_handler(tauri::generate_handler![
            commands::get_app_version,
            commands::get_platform,
            commands::get_tor_status,
            commands::is_mobile,
        ])
        // ── App setup ────────────────────────────────────────────────────────
        .setup(|app| {
            // On desktop platforms, start the local Express server.
            // On Android/iOS there is no Node.js — the frontend uses
            // direct Nostr WebSocket connections instead.
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                start_express_server(app.handle().clone());
            }

            // Open devtools in debug builds
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running M4TR1X application");
}

/// Spawns the Node.js Express server as a background sidecar process.
/// This only runs on desktop (Windows / macOS / Linux).
///
/// The server listens on 127.0.0.1:8080 and the frontend's fetch() calls
/// hit it exactly as they did in the old Electron setup.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn start_express_server(app: tauri::AppHandle) {
    use tauri_plugin_shell::ShellExt;
    use std::path::PathBuf;

    // Resolve the server entry point relative to the app resources directory.
    // In production builds, the server/ folder is packaged as an extra resource.
    let server_path: PathBuf = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("server")
        .join("index.js");

    let server_str = server_path.to_string_lossy().to_string();

    tauri::async_runtime::spawn(async move {
        let shell = app.shell();
        match shell
            .command("node")
            .args([server_str.as_str()])
            .spawn()
        {
            Ok(mut child) => {
                println!("[M4TR1X] Local server starting on port 8080");
                // Keep the child alive for the duration of the app.
                // If the server crashes, log the error but don't crash the app.
                let _ = child.wait().await;
                println!("[M4TR1X] Local server stopped.");
            }
            Err(e) => {
                eprintln!("[M4TR1X] Failed to start local server: {e}");
                eprintln!("[M4TR1X] Make sure Node.js is installed: https://nodejs.org");
            }
        }
    });
}
