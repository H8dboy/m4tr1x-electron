/**
 * M4TR1X - Tauri IPC Commands
 *
 * These replace the old Electron preload.js bridge.
 * Frontend calls:  await invoke('get_app_version')
 * instead of:      await window.m4tr1x_native.getVersion()
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
    pub port:        Option<u16>,
    pub source:      Option<String>,
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
                port:        Some(port),
                source:      Some(source),
            };
        }
    }
    TorStatus {
        tor_enabled: false,
        port:        None,
        source:      None,
    }
}

/// Returns true when running on Android or iOS.
/// The frontend uses this to hide desktop-only features
/// (local AI analysis, Monero wallet) on mobile.
#[tauri::command]
pub fn is_mobile() -> bool {
    cfg!(any(target_os = "android", target_os = "ios"))
}
