/**
 * Chiudere l'app deve fermare il Tor che l'app ha avviato.
 *
 * Il processo Tor e' spawnato detached: senza uno stop esplicito sopravvive
 * all'uscita e la macchina continua a pubblicare l'onion dopo che l'utente ha
 * chiuso la finestra — l'opposto di quello che si aspetta chi chiude un'app.
 *
 * Verifica anche il caso opposto, altrettanto importante: un Tor ESTERNO gia'
 * in ascolto quando siamo partiti non e' nostro e non va mai ucciso.
 *
 * Richiede i binari: npm run fetch-tor
 *
 *   node tests/test-tor-lifecycle.js
 */
'use strict'
const fs = require('fs')
const os = require('os')
const net = require('net')
const path = require('path')
const http = require('http')
const assert = require('assert')
const { spawn } = require('child_process')

const REPO = path.join(__dirname, '..')
const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const BIN = path.join(REPO, 'resources', 'tor', `${plat}-${arch}`, process.platform === 'win32' ? 'tor.exe' : 'tor')

if (!fs.existsSync(BIN)) {
  console.log('SALTATO: binario Tor assente. Esegui prima: npm run fetch-tor')
  process.exit(0)
}

const SOCKS = process.env.TOR_SOCKS_PORT || '19052'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'm4tr1x-tor-life-'))
process.env.M4TR1X_DATA_DIR = DATA
process.env.TOR_SOCKS_PORT = SOCKS
process.env.TOR_BINARY = BIN

const { ensureNodeTor, stopNodeTor } = require(path.join(REPO, 'server', 'tor_node.js'))

const portOpen = port => new Promise(res => {
  const s = net.createConnection({ port: Number(port), host: '127.0.0.1' })
  const fin = ok => { try { s.destroy() } catch {} ; res(ok) }
  s.setTimeout(1000)
  s.once('connect', () => fin(true))
  s.once('timeout', () => fin(false))
  s.once('error', () => fin(false))
})
const sleep = ms => new Promise(r => setTimeout(r, ms))
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }

const api = http.createServer((q, r) => r.end('api')).listen(0, '127.0.0.1')
const relay = http.createServer((q, r) => r.end('relay')).listen(0, '127.0.0.1')

api.on('listening', async () => {
  let failed = null
  let extPid = null
  let extDir = null
  try {
    // ── Caso 1: Tor avviato da noi -> stopNodeTor lo ferma davvero.
    const r = await ensureNodeTor(api.address().port, relay.address().port)
    assert.ok(r.ok && !r.external, 'Tor nostro non avviato: test non valido')
    assert.strictEqual(await portOpen(SOCKS), true, 'SOCKS non attivo dopo l avvio')
    console.log('  ok  Tor avviato dall app, SOCKS attivo')

    assert.strictEqual(stopNodeTor(), true, 'stopNodeTor non ha fermato nulla')
    for (let i = 0; i < 40 && await portOpen(SOCKS); i++) await sleep(250)
    assert.strictEqual(await portOpen(SOCKS), false, 'il SOCKS risponde ancora: Tor sopravvissuto alla chiusura')
    console.log('  ok  alla chiusura il Tor dell app e spento (nessun onion orfano)')

    // Chiamarlo di nuovo non deve esplodere ne' fingere di aver fatto qualcosa.
    assert.strictEqual(stopNodeTor(), false, 'stopNodeTor doveva essere idempotente')
    console.log('  ok  stop ripetuto: idempotente')

    // ── Caso 2: un Tor ESTERNO gia' in ascolto non e' nostro -> non si tocca.
    extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4tr1x-tor-ext-'))
    const extRc = path.join(extDir, 'torrc')
    fs.writeFileSync(extRc, `SocksPort ${SOCKS}\nDataDirectory ${path.join(extDir, 'd')}\nLog notice stderr\n`)
    const ext = spawn(BIN, ['-f', extRc], { stdio: 'ignore', detached: true })
    ext.unref()
    extPid = ext.pid
    for (let i = 0; i < 60 && !(await portOpen(SOCKS)); i++) await sleep(500)
    assert.strictEqual(await portOpen(SOCKS), true, 'il Tor esterno di prova non e salito')

    const r2 = await ensureNodeTor(api.address().port, relay.address().port)
    assert.strictEqual(r2.external, true, 'non ha riconosciuto il Tor esterno')
    assert.strictEqual(stopNodeTor(), false, 'ha provato a fermare un Tor che non e suo')
    await sleep(500)
    assert.ok(alive(extPid), 'ha ucciso il Tor esterno')
    assert.strictEqual(await portOpen(SOCKS), true, 'il Tor esterno non risponde piu')
    console.log('  ok  un Tor esterno viene riusato e mai ucciso')

    console.log('\n4/4 verifiche passate — Tor vive quanto l app, e solo se e nostro.')
  } catch (e) {
    failed = e
  } finally {
    api.close(); relay.close()
    if (extPid) { try { process.kill(-extPid, 'SIGTERM') } catch { try { process.kill(extPid, 'SIGTERM') } catch {} } }
    try { stopNodeTor() } catch {}
    try { fs.rmSync(DATA, { recursive: true, force: true }) } catch {}
    if (extDir) { try { fs.rmSync(extDir, { recursive: true, force: true }) } catch {} }
    if (failed) { console.error('\nFALLITO: ' + failed.message); process.exit(1) }
    process.exit(0)
  }
})
