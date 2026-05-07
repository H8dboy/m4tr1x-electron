/**
 * M4TR1X - Electron Main Process
 * Application entry point
 *
 * Security:
 *  - contextIsolation: true  → renderer cannot access Node.js APIs
 *  - nodeIntegration: false  → no Node.js access from frontend
 *  - webSecurity: true       → same-origin policy enforced
 *  - CSP via onHeadersReceived → blocks XSS and injection
 *  - setWindowOpenHandler    → external links open in system browser, never in-app
 *  - Tor auto-detect + embedded → if Tor not running, starts bundled Tor automatically
 */

const { app, BrowserWindow, ipcMain, shell, Menu, session } = require('electron')
const path   = require('path')
const fs     = require('fs')
const crypto = require('crypto')
const { setupTorIfAvailable, stopTorDaemon } = require('./server/tor')

// ─── Generazione automatica segreti al primo avvio ───────────────────────────
function ensureSecrets() {
  const userDataPath = app.getPath('userData')
  const envPath      = path.join(userDataPath, '.env.runtime')
  if (!fs.existsSync(envPath)) {
    const secret    = crypto.randomBytes(32).toString('hex')
    const adminKey  = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(envPath, `APP_SECRET=${secret}\nADMIN_KEY=${adminKey}\n`, { mode: 0o600 })
    console.log('[M4TR1X] Secrets generated at first launch →', envPath)
  }
  const raw = fs.readFileSync(envPath, 'utf8')
  raw.split('\n').forEach(line => {
    const [k, ...v] = line.split('=')
    if (k && v.length) process.env[k.trim()] = v.join('=').trim()
  })
}

const localEnv = path.join(__dirname, '.env')
if (fs.existsSync(localEnv)) {
  require('dotenv').config({ path: localEnv })
} else {
  ensureSecrets()
}

let mainWindow
let torStatus = { torEnabled: false, port: null, source: null }
const SERVER_PORT = 8080

function waitForServer(port, maxMs = 15000) {
  const http = require('http')
  const start = Date.now()
  return new Promise((resolve, reject) => {
    function attempt() {
      http.get(`http://localhost:${port}/app`, res => {
        res.resume()
        resolve()
      }).on('error', () => {
        if (Date.now() - start > maxMs) return reject(new Error('Server timeout'))
        setTimeout(attempt, 300)
      })
    }
    attempt()
  })
}

function setupCSP() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self' http://localhost:8080",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: https:",
            "media-src 'self' https:",
            "connect-src 'self' http://localhost:8080 ws://localhost:4848 wss: https:",
            "frame-src https:",
            "object-src 'none'",
            "base-uri 'self'",
          ].join('; '),
        ],
      },
    })
  })
}

async function createWindow() {
  // Detect Tor BEFORE opening any network connections
  // Cascata automatica: Tor Browser → daemon → embedded → bridges
  torStatus = await setupTorIfAvailable(session.defaultSession)
  if (torStatus.torEnabled) {
    console.log(`[M4TR1X] 🧅 Tor active (${torStatus.source}) — maximum privacy`)
  }

  setupCSP()

  mainWindow = new BrowserWindow({
    width:     420,
    height:    900,
    minWidth:  375,
    minHeight: 667,
    show:      false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      true,
      sandbox:          true,
    },
    titleBarStyle:   process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#000000',
    title:           torStatus.torEnabled
                       ? 'M4TR1X 🧅 — The Unfiltered Eye (Tor)'
                       : 'M4TR1X — The Unfiltered Eye',
    icon: path.join(__dirname, 'assets/icon.png'),
  })

  const loadingPath = path.join(__dirname, 'frontend', 'loading.html')
  await mainWindow.loadFile(loadingPath)
  mainWindow.show()

  try {
    const { startServer } = require('./server/index')
    await startServer(SERVER_PORT)
    console.log(`[M4TR1X] Local server running on port ${SERVER_PORT}`)
  } catch (err) {
    console.error('[M4TR1X] Failed to start server:', err)
  }

  try {
    await waitForServer(SERVER_PORT)
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}/app`)
  } catch (err) {
    console.error('[M4TR1X] Server did not respond in time:', err)
    mainWindow.webContents.executeJavaScript(
      `document.body.innerHTML='<div style="color:#ff4455;font-family:monospace;padding:40px;text-align:center">[ SERVER ERROR ]<br><br>${err.message}<br><br>Riavvia l\'app.</div>'`
    )
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://localhost:${SERVER_PORT}`)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }
}

ipcMain.handle('get-app-version',    () => app.getVersion())
ipcMain.handle('get-platform',       () => process.platform)
ipcMain.handle('get-user-data-path', () => app.getPath('userData'))
ipcMain.handle('get-tor-status',     () => torStatus)

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})

app.on('before-quit', async () => {
  try { require('./server/index').stopServer() } catch (_) {}
  try { await stopTorDaemon() } catch (_) {}
})
