/**
 * M4TR1X - Tauri IPC Commands
 *
 * These replace the old Electron preload.js bridge.
 * Frontend calls: await invoke('get_app_version')
 * instead of: await window.m4tr1x_native.getVersion()
 */

use serde::{Deserialize, Serialize};

/// Returns the app version from Cargo.toml
#[tauri::command]
pub fn get_app_version() -> String {
        env!("CARGO_PKG_VERSION").to_string()
}

/// Returns the current platform identifier
/// Mirrors Electron's process.platform values for frontend compatibility
#[tauri::command]
pub fn get_platform() -> String {
        if cfg!(target_os = "windows") {
                    "win32".to_string()
        } else if cfg!(target_os = "macos") {
                    "darwin".to_string()
        } else if cfg!(target_os = "android") {
                    "android".to_string()
        } else if cfg!(target_os = "ios") {
                    "ios".to_string()
        } else {
                    "linux".to_string()
        }
}

#[derive(Serialize, Deserialize)]
pub struct TorStatus {
        pub tor_enabled: bool,
        pub port: Option<u16>,
        pub source: Option<String>,
}

/// Checks if Tor proxy is available on the standard ports.
/// Mirrors the old Electron tor.js detection logic.
#[tauri::command]
pub async fn get_tor_status() -> TorStatus {
        // Try to connect to common Tor SOCKS5 ports
    let tor_ports: &[u16] = &[9050, 9150];
        for &port in tor_ports {
                    let addr = format!("127.0.0.1:{port}");
                    if tokio::net::TcpStream::connect(&addr).await.is_ok() {
                                    let source = if port == 9150 {
                                                        "Tor Browser".to_string()
                                    } else {
                                                        "tor daemon".to_string()
                                    };
                                    return TorStatus {
                                                        tor_enabled: true,
                                                        port: Some(port),
                                                        source: Some(source),
                                    };
                    }
        }
        TorStatus {
                    tor_enabled: false,
                    port: None,
                    source: None,
        }
}

/// Returns true when running on Android or iOS.
/// The frontend uses this to hide desktop-only features
/// (local AI analysis, Monero wallet) on mobile.
#[tauri::command]
pub fn is_mobile() -> bool {
        cfg!(any(target_os = "android", target_os = "ios"))
}

/// Triggered by the frontend "INSTALLA AGGIORNAMENTO" button.
/// Downloads and installs the update, then asks the user to restart.
/// Only available on desktop — mobile updates go through the app stores.
#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<String, String> {
        use tauri_plugin_updater::UpdaterExt;

    let updater = app.updater().map_err(|e| e.to_string())?;
        match updater.check().await.map_err(|e| e.to_string())? {
                    Some(update) => {
                                    let version = update.version.clone();
                                    // Download and stage the installer — runs in background
                        update
                                        .download_and_install(|_, _| {}, || {})
                                        .await
                                        .map_err(|e| e.to_string())?;
                                    Ok(format!("Update {} installed. Please restart M4TR1X.", version))
                    }
                    None => Ok("Already up to date.".to_string()),
        }
}

/// Stub for mobile — the invoke_handler needs a consistent signature on all platforms.
#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn check_for_updates(_app: tauri::AppHandle) -> Result<String, String> {
        Ok("Updates are handled by the app store on mobile.".to_string())
}
