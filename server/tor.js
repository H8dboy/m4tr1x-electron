/**
 * M4TR1X - Tor Integration
 *
 * Per utenti in Iran, Cina, Gaza, Bielorussia, e ovunque la rete sia sorvegliata.
 * Tor rende invisibili le connessioni ai relay Nostr, Mastodon, PeerTube.
 * Nessun ISP può vedere con chi comunichi o cosa pubblichi.
 *
 * Funziona in quattro modalità (automatiche, nessuna configurazione richiesta):
 *   1. Tor Browser già aperto     → usa porta 9150
 *   2. Tor daemon standalone      → usa porta 9050
 *   3. Tor embedded bundato       → avvia automaticamente
 *   4. Nessun Tor rilevato        → mostra guida in-app con bridge pre-configurati
 *
 * Bridge integrati (obfs4 + Snowflake) per paesi con DPI (Iran, Cina, Russia):
 *   Questi bridge mascherano il traffico Tor come normale HTTPS.
 *   Aggiornati dalla Tor Project Bridge Database — aggiornare a ogni release.
 */

const net  = require('net')
const path = require('path')
const { execFile } = require('child_process')
const fs   = require('fs')
const { startTorDaemon, stopTorDaemon } = require('./tor-embedded')

// ─── Porte Tor standard ──────────────────────────────────────────────────────
const TOR_PORTS = [
  { port: 9150, source: 'Tor Browser' },
  { port: 9050, source: 'Tor daemon'  },
]

// ─── Bridge pubblici pre-configurati ──────────────────────────────────────────
const DEFAULT_BRIDGES = {
  obfs4: [
    'obfs4 193.11.166.194:27015 2D82C2E354D531A68469ADF7F878390640087A33 cert=4TLQPJrTSaDffMK7Nbao6LC7G9OW/NHkUwIdjLSS3KYf06igE7t05ipN9m6BoNp37UFgeg iat-mode=0',
    'obfs4 37.218.240.34:40035 88CD36D45A35271963EF82B6058BD1480AA5B6D6 cert=9Mh8JVzQxMkWVpTBKT2FKUY6YU8zBs7E5p+7M6UZ6ZSp0JDWm2ey5Q3HwQFjHJ+Lg iat-mode=0',
  ],
  snowflake: [
    'snowflake 192.0.2.3:80 2B280B23E1107BB62ABFC40DDCC8824814F80A72 fingerprint=2B280B23E1107BB62ABFC40DDCC8824814F80A72 url=https://snowflake-broker.torproject.net.global.prod.fastly.net/ front=ajax.microsoft.com',
  ],
}

// ─── Percorsi Tor Browser per piattaforma ─────────────────────────────────────
function getTorBrowserPaths() {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  switch (process.platform) {
    case 'win32': return [
      path.join(process.env.LOCALAPPDATA || '', 'Tor Browser', 'Browser', 'firefox.exe'),
      path.join(process.env.ProgramFiles  || '', 'Tor Browser', 'Browser', 'firefox.exe'),
      path.join(home, 'Desktop', 'Tor Browser', 'Browser', 'firefox.exe'),
    ]
    case 'darwin': return [
      '/Applications/Tor Browser.app/Contents/MacOS/firefox',
      path.join(home, 'Applications', 'Tor Browser.app', 'Contents', 'MacOS', 'firefox'),
    ]
    default: return [
      path.join(home, 'tor-browser', 'Browser', 'start-tor-browser'),
      '/opt/tor-browser/Browser/start-tor-browser',
      '/usr/bin/torbrowser-launcher',
    ]
  }
}

// ─── Core functions ────────────────────────────────────────────────────────

function checkPort(port) {
  return new Promise((resolve) => {
    const socket  = new net.Socket()
    const timeout = setTimeout(() => { socket.destroy(); resolve(false) }, 1500)
    socket.connect(port, '127.0.0.1', () => {
      clearTimeout(timeout); socket.destroy(); resolve(true)
    })
    socket.on('error', () => { clearTimeout(timeout); resolve(false) })
  })
}

async function detectTor() {
  for (const { port, source } of TOR_PORTS) {
    const found = await checkPort(port)
    if (found) {
      console.log(`[TOR] Rilevato: ${source} su porta ${port}`)
      return { available: true, port, source }
    }
  }
  return { available: false, port: null, source: null }
}

async function tryLaunchTorBrowser() {
  const paths = getTorBrowserPaths()
  for (const tbPath of paths) {
    if (fs.existsSync(tbPath)) {
      console.log(`[TOR] Trovato Tor Browser in: ${tbPath}`)
      try {
        execFile(tbPath, { detached: true, stdio: 'ignore' }, () => {})
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 1000))
          const up = await checkPort(9150)
          if (up) {
            console.log('[TOR] Tor Browser avviato con successo')
            return true
          }
        }
      } catch (err) {
        console.log(`[TOR] Errore lancio Tor Browser: ${err.message}`)
      }
    }
  }
  return false
}

async function applyTorProxy(session, torPort) {
  await session.setProxy({
    proxyRules:      `socks5://127.0.0.1:${torPort}`,
    proxyBypassRules: 'localhost,127.0.0.1',
  })
  console.log(`[TOR] Proxy attivo: socks5://127.0.0.1:${torPort}`)
}

async function removeTorProxy(session) {
  await session.setProxy({ proxyRules: 'direct://' })
  console.log('[TOR] Proxy rimosso')
}

/**
 * Setup completo con cascata:
 * 1. Tor Browser (9150)
 * 2. Tor daemon (9050)
 * 3. Tor embedded (bundato)
 * 4. Bridge fallback
 */
async function setupTorIfAvailable(electronSession) {
  console.log('[TOR] Inizio rilevazione Tor...')
  
  // Passo 1: Tor già in esecuzione?
  let tor = await detectTor()
  
  // Passo 2: Prova ad avviare Tor Browser se installato
  if (!tor.available) {
    console.log('[TOR] Tor Browser/daemon non rilevati, provo Tor Browser...')
    const launched = await tryLaunchTorBrowser()
    if (launched) {
      tor = { available: true, port: 9150, source: 'Tor Browser (auto-avviato)' }
    }
  }
  
  // Passo 3: Avvia Tor embedded se disponibile
  if (!tor.available) {
    console.log('[TOR] Nessun Tor rilevato, provo embedded...')
    try {
      const embedded = await startTorDaemon()
      tor = { available: true, port: 9050, source: 'M4TR1X Embedded Tor' }
    } catch (err) {
      console.warn('[TOR] Embedded Tor fallito:', err.message)
    }
  }
  
  if (tor.available) {
    await applyTorProxy(electronSession, tor.port)
    return {
      torEnabled: true,
      port:       tor.port,
      source:     tor.source,
      bridges:    null,
    }
  }
  
  // Passo 4: Nessun Tor — restituisce bridge per setup manuale
  console.log('[TOR] Tor non disponibile. Bridge pre-configurati disponibili.')
  return {
    torEnabled: false,
    port:       null,
    source:     null,
    bridges:    DEFAULT_BRIDGES,
  }
}

function getRecommendedBridges(countryHint = null) {
  const high_censorship = ['ir', 'cn', 'ru', 'by', 'kp', 'cu']
  if (high_censorship.includes(countryHint?.toLowerCase())) {
    return {
      primary:   DEFAULT_BRIDGES.snowflake,
      secondary: DEFAULT_BRIDGES.obfs4,
      type:      'snowflake+obfs4',
      reason:    'Snowflake maschera il traffico come WebRTC.',
    }
  }
  return {
    primary:   DEFAULT_BRIDGES.obfs4,
    secondary: DEFAULT_BRIDGES.snowflake,
    type:      'obfs4+snowflake',
    reason:    'obfs4 è il bridge più stabile.',
  }
}

module.exports = {
  detectTor,
  applyTorProxy,
  removeTorProxy,
  setupTorIfAvailable,
  getRecommendedBridges,
  startTorDaemon,
  stopTorDaemon,
  DEFAULT_BRIDGES,
}
