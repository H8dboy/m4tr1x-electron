'use strict'
/**
 * M4TR1X - Tor gestito dal nodo (server-side)
 *
 * Obiettivo "scarichi -> avvii -> sei dentro": il nodo avvia da solo un proprio
 * processo Tor con un hidden service nella SUA cartella dati. Nessuna
 * configurazione manuale, nessun problema di permessi (il pacchetto di sistema
 * gira come utente debian-tor con la dir a 700 e il nodo non potrebbe leggere
 * l'hostname; qui Tor gira come l'utente del nodo, quindi l'onion e' leggibile).
 *
 * Fornisce due cose:
 *   1. SOCKS 127.0.0.1:9050  -> per raggiungere l'head node .onion in uscita
 *   2. onion proprio          -> per essere raggiungibile inbound come relay
 *
 * Se un Tor e' gia' in ascolto su 9050 (es. istanza dedicata gia' presente,
 * come sul nodo edge Oracle) viene riusato e non se ne avvia un altro.
 */

const net  = require('net')
const fs   = require('fs')
const os   = require('os')
const path = require('path')
const { spawn, execFileSync } = require('child_process')

// Cartella dati: la stessa che node_manager.getOnionAddress() usa come fallback
// per cercare l'hostname dell'onion. NON process.cwd(): in un'app impacchettata
// la working dir puo' essere di sola lettura o cambiare tra un avvio e l'altro,
// e Tor perderebbe la chiave del hidden service (= onion diverso a ogni riavvio).
const DATA_DIR      = process.env.M4TR1X_DATA_DIR || path.join(os.homedir(), '.config', 'm4tr1x')
const TOR_DIR       = path.join(DATA_DIR, 'tor')
const HS_DIR        = path.join(TOR_DIR, 'hs')
const TORRC         = path.join(TOR_DIR, 'torrc')
const HOSTNAME_FILE = path.join(HS_DIR, 'hostname')
const SOCKS_PORT    = parseInt(process.env.TOR_SOCKS_PORT || '9050', 10)

function _portOpen (port, host = '127.0.0.1', timeout = 1500) {
  return new Promise(resolve => {
    const s = net.createConnection({ port, host })
    let done = false
    const fin = ok => { if (!done) { done = true; try { s.destroy() } catch {} ; resolve(ok) } }
    s.setTimeout(timeout)
    s.once('connect', () => fin(true))
    s.once('timeout', () => fin(false))
    s.once('error',   () => fin(false))
  })
}
const _sleep = ms => new Promise(r => setTimeout(r, ms))

// Cartelle dove cerchiamo un Tor spedito con l'app (Electron: resources/tor/<piattaforma>).
// Cosi' l'app desktop ha l'onion "out of the box" anche su una macchina senza Tor.
function _bundledTorDirs () {
  const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const key  = `${plat}-${arch}`
  const dirs = []
  if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, 'tor', key))
  dirs.push(path.join(__dirname, '..', 'resources', 'tor', key))
  return dirs
}

function _findTor () {
  if (process.env.TOR_BINARY && fs.existsSync(process.env.TOR_BINARY)) return process.env.TOR_BINARY
  // 1) Tor spedito con l'app (versione controllata, nessuna dipendenza dal sistema).
  const exe = process.platform === 'win32' ? 'tor.exe' : 'tor'
  for (const d of _bundledTorDirs()) {
    const b = path.join(d, exe)
    try { if (fs.existsSync(b)) return b } catch {}
  }
  // 2) Tor di sistema.
  for (const p of ['/usr/bin/tor', '/usr/sbin/tor', '/usr/local/bin/tor', '/opt/homebrew/bin/tor']) {
    try { if (fs.existsSync(p)) return p } catch {}
  }
  try { const p = execFileSync('sh', ['-c', 'command -v tor'], { encoding: 'utf8' }).trim(); if (p) return p } catch {}
  return 'tor' // ultimo tentativo: lookup nel PATH via spawn
}

// Il Tor spedito con l'app si porta dietro le proprie libssl/libcrypto/libevent,
// nella stessa cartella del binario. Senza indicarla al loader, su Linux/macOS
// verrebbero usate quelle di SISTEMA se presenti — e su una macchina che non le
// ha (o le ha incompatibili) l'avvio fallirebbe: cioe' proprio lo scenario che il
// bundling deve coprire. Su Windows le DLL accanto all'eseguibile bastano.
function _spawnEnv (bin) {
  const env = { ...process.env }
  const dir = path.dirname(bin)
  let hasLibs = false
  try { hasLibs = fs.readdirSync(dir).some(f => /\.(so|dylib)(\.|$)/.test(f)) } catch {}
  if (!hasLibs) return env
  const key = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH'
  env[key] = env[key] ? `${dir}:${env[key]}` : dir
  return env
}

let _child = null

/**
 * Garantisce che il nodo abbia Tor (SOCKS + onion) senza alcun intervento manuale.
 * Ritorna true se un SOCKS Tor e' pronto su SOCKS_PORT.
 */
async function ensureNodeTor (apiPort, relayPort) {
  // Percorso onion pre-scritto: il resto del nodo (getOnionAddress) lo legge da qui.
  if (!process.env.TOR_HOSTNAME_FILE) process.env.TOR_HOSTNAME_FILE = HOSTNAME_FILE

  // 1) Tor gia' in ascolto -> riusa (non avviarne un secondo sullo stesso porto).
  if (await _portOpen(SOCKS_PORT)) {
    console.log(`[tor] SOCKS gia' attivo su 127.0.0.1:${SOCKS_PORT} - riuso. Se questo Tor pubblica un onion del nodo, la sua HiddenServicePort deve puntare a 127.0.0.1:${apiPort} (ingresso Tor), non alla porta HTTP.`)
    return { ok: true, external: true }
  }

  // 2) Avvia un Tor gestito dal nodo, con hidden service nella cartella del nodo.
  const bin = _findTor()
  try {
    fs.mkdirSync(HS_DIR, { recursive: true })
    fs.chmodSync(TOR_DIR, 0o700)
    fs.chmodSync(HS_DIR, 0o700)
  } catch (e) { console.warn(`[tor] mkdir dati Tor fallita: ${e.message}`) }

  const torrc = [
    `SocksPort ${SOCKS_PORT}`,
    `DataDirectory ${TOR_DIR}`,
    `HiddenServiceDir ${HS_DIR}`,
    `HiddenServicePort 80 127.0.0.1:${apiPort}`,
    `HiddenServicePort 4848 127.0.0.1:${relayPort}`,
    `Log notice stderr`,
    ``,
  ].join('\n')
  try { fs.writeFileSync(TORRC, torrc) } catch (e) { console.warn(`[tor] scrittura torrc fallita: ${e.message}`); return { ok: false, external: false } }

  try {
    _child = spawn(bin, ['-f', TORRC], { detached: true, stdio: 'ignore', env: _spawnEnv(bin) })
    _child.on('error', e => console.warn(`[tor] avvio Tor fallito (${e.code || e.message}). Installa il pacchetto "tor".`))
    _child.unref()
    console.log(`[tor] Avvio Tor gestito dal nodo (${bin})...`)
  } catch (e) {
    console.warn(`[tor] Tor non avviato: ${e.message}. Il nodo proseguira' senza onion finche' un SOCKS non e' disponibile.`)
    return { ok: false, external: false }
  }

  // 3) Attendi il bootstrap (SOCKS raggiungibile) fino a ~90s.
  for (let i = 0; i < 90; i++) {
    if (await _portOpen(SOCKS_PORT)) {
      console.log(`[tor] Tor del nodo pronto (SOCKS ${SOCKS_PORT}).`)
      for (let j = 0; j < 20; j++) { if (fs.existsSync(HOSTNAME_FILE)) break; await _sleep(500) }
      try { console.log(`[tor] Onion del nodo: ${fs.readFileSync(HOSTNAME_FILE, 'utf8').trim()}`) } catch {}
      return { ok: true, external: false }
    }
    await _sleep(1000)
  }
  console.warn('[tor] Tor non ha completato il bootstrap in tempo; il nodo riprovera\' con l\'heartbeat.')
  return { ok: false, external: false }
}

/**
 * Ferma il Tor avviato da noi. Va chiamato quando l'app si chiude: il processo
 * e' spawnato detached e sopravviverebbe all'uscita, lasciando la macchina a
 * pubblicare l'onion dopo che l'utente ha chiuso la finestra.
 *
 * Un Tor ESTERNO (gia' in ascolto quando siamo partiti) non viene mai toccato:
 * non e' nostro, e potrebbe servire ad altro sul computer dell'utente.
 * Ritorna true se abbiamo effettivamente fermato un processo nostro.
 */
function stopNodeTor () {
  if (!_child || !_child.pid) return false
  const pid = _child.pid
  _child = null
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      // spawn detached mette Tor in un suo process group (pgid = pid): il segno
      // meno lo termina insieme a eventuali figli. Se il gruppo non c'e' piu',
      // si ripiega sul solo pid.
      try { process.kill(-pid, 'SIGTERM') } catch { process.kill(pid, 'SIGTERM') }
    }
    console.log('[tor] Tor del nodo fermato.')
    return true
  } catch (e) {
    if (e.code !== 'ESRCH') console.warn(`[tor] stop Tor fallito: ${e.message}`)
    return false
  }
}

module.exports = { ensureNodeTor, stopNodeTor, HOSTNAME_FILE, TOR_DIR, SOCKS_PORT }
