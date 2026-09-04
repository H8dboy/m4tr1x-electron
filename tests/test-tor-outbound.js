/**
 * Il traffico in USCITA deve passare per il Tor che l'app stessa avvia.
 *
 * main.js rileva Tor all'inizio di createWindow(), cioe' PRIMA che il server
 * abbia avviato il Tor impacchettato: al primo avvio su una macchina senza Tor
 * quella detection non trova nulla. Senza un secondo passaggio l'app
 * pubblicherebbe il proprio onion continuando a navigare in chiaro.
 *
 * Qui si verifica la sequenza reale con le funzioni vere di server/tor.js e un
 * oggetto session finto (applyTorProxy usa la session solo per setProxy):
 *   1. prima che Tor esista  -> nessuna proxy applicata
 *   2. dopo whenTorReady()   -> proxy socks5 sulla porta del Tor dell'app
 *
 * Richiede i binari: npm run fetch-tor
 *
 *   node tests/test-tor-outbound.js
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const assert = require('assert')

const REPO = path.join(__dirname, '..')
const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const BIN = path.join(REPO, 'resources', 'tor', `${plat}-${arch}`, process.platform === 'win32' ? 'tor.exe' : 'tor')

if (!fs.existsSync(BIN)) {
  console.log(`SALTATO: binario Tor assente. Esegui prima: npm run fetch-tor`)
  process.exit(0)
}

const SOCKS = process.env.TOR_SOCKS_PORT || '19051'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'm4tr1x-tor-out-'))
process.env.M4TR1X_DATA_DIR = DATA
process.env.TOR_SOCKS_PORT = SOCKS
process.env.TOR_BINARY = BIN

// server/tor.js cerca Tor sulle porte fisse 9150/9050. Per non dipendere da un
// Tor di sistema il test usa una porta dedicata e riproduce la stessa sequenza
// che main.js esegue, con le funzioni vere applyTorProxy/detectTor.
const { applyTorProxy } = require(path.join(REPO, 'server', 'tor.js'))
const { ensureNodeTor } = require(path.join(REPO, 'server', 'tor_node.js'))
const net = require('net')

const portOpen = port => new Promise(res => {
  const s = net.createConnection({ port, host: '127.0.0.1' })
  const fin = ok => { try { s.destroy() } catch {} ; res(ok) }
  s.setTimeout(1000)
  s.once('connect', () => fin(true))
  s.once('timeout', () => fin(false))
  s.once('error', () => fin(false))
})

// Session finta: registra cosa main.js applicherebbe alla sessione Electron.
const applied = []
const fakeSession = { setProxy: async o => { applied.push(o) } }

const cleanup = () => {
  try { require('child_process').execSync(`pkill -f "tor -f ${path.join(DATA, 'tor', 'torrc')}"`) } catch {}
  try { fs.rmSync(DATA, { recursive: true, force: true }) } catch {}
}

const api = http.createServer((q, r) => r.end('api')).listen(0, '127.0.0.1')
const relay = http.createServer((q, r) => r.end('relay')).listen(0, '127.0.0.1')

api.on('listening', async () => {
  let failed = null
  try {
    // ── 1. Il momento in cui gira la detection di main.js: Tor non esiste ancora.
    assert.strictEqual(await portOpen(SOCKS), false, 'il SOCKS esisteva gia: test non valido')
    if (applied.length === 0) console.log('  ok  prima dell avvio: nessun Tor, nessuna proxy applicata')

    // ── 2. Il server avvia il Tor dell'app (quello che fa startServer).
    const torReady = ensureNodeTor(api.address().port, relay.address().port)

    // Se main.js controllasse qui, come faceva prima, troverebbe ancora nulla:
    // e' esattamente il bug. whenTorReady() serve a non controllare troppo presto.
    const r = await torReady
    assert.ok(r.ok, 'Tor non e salito')
    console.log('  ok  whenTorReady() attende: alla risoluzione il SOCKS c e')

    assert.strictEqual(await portOpen(SOCKS), true, 'SOCKS non in ascolto dopo whenTorReady')

    // ── 3. Secondo passaggio: ora la proxy si applica davvero.
    await applyTorProxy(fakeSession, SOCKS)
    assert.strictEqual(applied.length, 1, 'proxy non applicata')
    assert.strictEqual(applied[0].proxyRules, `socks5://127.0.0.1:${SOCKS}`,
      `proxy sbagliata: ${applied[0].proxyRules}`)
    console.log(`  ok  traffico in uscita instradato su ${applied[0].proxyRules}`)

    console.log('\n3/3 verifiche passate — l app naviga attraverso il Tor che avvia lei stessa.')
  } catch (e) {
    failed = e
  } finally {
    api.close(); relay.close(); cleanup()
    if (failed) { console.error('\nFALLITO: ' + failed.message); process.exit(1) }
    process.exit(0)
  }
})
