/**
 * M4TR1X Universal Bridge
 *
 * Exposes window.m4tr1x_native on all runtimes:
 *   - Tauri v2 (desktop + Android + iOS)  → uses window.__TAURI__.core.invoke
 *   - Electron (legacy)                    → already injected by preload.js
 *   - Browser / PWA                        → undefined (features degrade gracefully)
 *
 * Include this script at the top of every HTML page, BEFORE any app code.
 * It is a no-op if window.m4tr1x_native is already defined (Electron case).
 */
;(function () {
  'use strict'

  // Already set by Electron's preload.js — nothing to do
  if (window.m4tr1x_native) return

  // Running inside Tauri v2 (withGlobalTauri: true in tauri.conf.json)
  if (window.__TAURI__) {
    var invoke = window.__TAURI__.core.invoke

    window.m4tr1x_native = {
      // ── App info ────────────────────────────────────────────────────────
      getVersion:      function () { return invoke('get_app_version') },
      getPlatform:     function () { return invoke('get_platform') },
      getUserDataPath: function () { return Promise.resolve('') },

      // ── Tor detection ────────────────────────────────────────────────────
      // Rust returns snake_case — normalise to camelCase for frontend compat
      getTorStatus: function () {
        return invoke('get_tor_status').then(function (s) {
          return {
            torEnabled: s.tor_enabled,
            port:       s.port   || null,
            source:     s.source || null,
          }
        })
      },

      // ── Platform flags ───────────────────────────────────────────────────
      isTauri:    true,
      isElectron: false,

      // isMobile() → true on Android/iOS, false on desktop
      isMobile: function () { return invoke('is_mobile') },
    }

    return
  }

  // Running in a plain browser (PWA / web).
  // m4tr1x_native stays undefined — the app degrades gracefully
  // (Tor status bar is hidden, native file pickers fall back to <input type=file>)
})()
