/**
 * M4TR1X - Embedded Tor Daemon
 * 
 * Questo bundla Tor direttamente dentro l'app, permettendo ai client
 * di connettersi agli indirizzi .onion senza avere Tor Browser installato.
 * 
 * Perfetto per il use case M4TR1X:
 *   - Il nodo server gira su .onion (es: abc123.onion:4848)
 *   - I client M4TR1X si connettono via SOCKS5 locale (9050)
 *   - Anonimato garantito senza configurazione utente
 */

const { spawn } = require('child_process')
const path = require('path')
const net = require('net')
const fs = require('fs')
const os = require('os')

let torProcess = null
let torReady = false

/**
 * Detecta il path al binario Tor bundato in base a piattaforma/architettura
 */
function getTorBinaryPath() {
  // In development: ./tor-bin
  // In production (Electron): process.resourcesPath/tor-bin
  const resourcesPath = process.resourcesPath || path.join(__dirname, '..')
  const torBinDir = path.join(resourcesPath, 'tor-bin')
  
  switch (process.platform) {
    case 'win32':
      return path.join(torBinDir, 'win', process.arch === 'x64' ? 'tor.exe' : 'tor-x86.exe')
    case 'darwin':
      return path.join(torBinDir, 'macos', process.arch === 'arm64' ? 'tor-arm64' : 'tor-x64')
    case 'linux':
      return path.join(torBinDir, 'linux', process.arch === 'arm64' ? 'tor-arm64' : 'tor-x64')
    default:
      throw new Error(`[TOR-EMBEDDED] Piattaforma non supportata: ${process.platform}`)
  }
}

/**
 * Genera directory e restituisce path della cartella dati Tor
 */
function getTorDataDir() {
  const dataDir = process.env.M4TR1X_DATA_DIR || path.join(os.homedir(), '.m4tr1x')
  const torDir = path.join(dataDir, '.tor')
  
  if (!fs.existsSync(torDir)) {
    fs.mkdirSync(torDir, { recursive: true, mode: 0o700 })
  }
  return torDir
}

/**
 * Genera file torrc (configurazione Tor)
 * Abilita:
 *  - SOCKS proxy su porta 9050 (per client .onion)
 *  - Control port per monitoraggio
 *  - Circuit isolation (per privacy)
 */
function generateTorrc() {
  const torDir = getTorDataDir()
  const torrc = path.join(torDir, 'torrc')
  const dataDir = path.join(torDir, 'data')
  const controlPort = 9051
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  }
  
  const config = `# M4TR1X Embedded Tor Configuration
# Generato automaticamente - NON MODIFICARE

## Dati Tor
DataDirectory ${dataDir}
PidFile ${path.join(torDir, 'tor.pid')}

## SOCKS Server (per client .onion)
SocksPort 9050
SocksPolicy accept *

## Control port (per monitoraggio/shutdown)
ControlPort ${controlPort}
CookieAuthentication 1

## Privacy
StreamIsolateByDestination 1
CircuitStreamTimeout 60

## Log
Log notice file ${path.join(torDir, 'tor.log')}
`
  
  fs.writeFileSync(torrc, config, { mode: 0o600 })
  return torrc
}

/**
 * Verifica se il SOCKS port è raggiungibile
 */
function checkSocksPort(port = 9050) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(1000)
    socket.connect(port, '127.0.0.1', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

/**
 * Avvia il daemon Tor embedded
 * Returns: Promise<{ port: 9050, ready: boolean, message: string }>
 */
function startTorDaemon() {
  return new Promise((resolve, reject) => {
    if (torReady) {
      resolve({ port: 9050, ready: true, message: 'Tor già in esecuzione' })
      return
    }
    
    try {
      const torBinary = getTorBinaryPath()
      const torrc = generateTorrc()
      
      if (!fs.existsSync(torBinary)) {
        throw new Error(`Binario Tor non trovato: ${torBinary}\nEsegui: npm run download-tor-binaries`)
      }
      
      console.log('[TOR-EMBEDDED] Avvio daemon Tor...')
      console.log('[TOR-EMBEDDED] Binary:', torBinary)
      
      // Avvia il daemon Tor in background
      torProcess = spawn(torBinary, ['-f', torrc, '--quiet'], {
        stdio: 'ignore',
        detached: true
      })
      
      torProcess.unref() // Non aspettare che finisca
      
      // Aspetta che il SOCKS port sia disponibile (max 30 secondi)
      const maxAttempts = 60 // 60 * 500ms = 30 secondi
      let attempts = 0
      
      function checkSocks() {
        checkSocksPort(9050).then((ok) => {
          if (ok) {
            torReady = true
            console.log('[TOR-EMBEDDED] ✅ Tor daemon pronto su 127.0.0.1:9050')
            resolve({ port: 9050, ready: true, message: 'Tor embedded avviato con successo' })
          } else if (attempts++ < maxAttempts) {
            setTimeout(checkSocks, 500)
          } else {
            reject(new Error('[TOR-EMBEDDED] Timeout avvio Tor (30s) - binario potrebbe essere corrotto'))
          }
        })
      }
      
      checkSocks()
      
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Arresta il daemon Tor
 */
function stopTorDaemon() {
  return new Promise((resolve) => {
    if (!torProcess) {
      resolve()
      return
    }
    
    try {
      if (process.platform === 'win32') {
        require('child_process').exec(`taskkill /PID ${torProcess.pid} /F`, () => {})
      } else {
        try {
          process.kill(-torProcess.pid, 'SIGTERM')
        } catch (e) {
          // PID potrebbe non essere più valido
        }
      }
      torReady = false
      torProcess = null
      console.log('[TOR-EMBEDDED] Tor daemon fermato')
    } catch (err) {
      console.warn('[TOR-EMBEDDED] Errore stop:', err.message)
    }
    
    setTimeout(resolve, 500)
  })
}

/**
 * Verifica se Tor è pronto e raggiungibile
 */
async function isTorReady() {
  return checkSocksPort(9050)
}

module.exports = {
  startTorDaemon,
  stopTorDaemon,
  isTorReady,
  getTorDataDir,
  getTorBinaryPath,
}
