/**
 * Il Tor spedito con l'app deve bastare da solo.
 *
 * Verifica la promessa "scarichi -> avvii -> sei dentro": su una macchina senza
 * Tor installato, ensureNodeTor avvia il binario impacchettato, apre il SOCKS e
 * genera un onion; e il torrc punta il hidden service al LISTENER DI INGRESSO,
 * mai alla porta HTTP principale (altrimenti ogni visitatore .onion arriverebbe
 * da 127.0.0.1 e sarebbe scambiato per il proprietario — vedi test-tor-ingress).
 *
 * Richiede i binari: npm run fetch-tor
 * Usa una porta SOCKS dedicata (19050) per non toccare un Tor di sistema.
 *
 *   node tests/test-tor-bundle.js
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const REPO = path.join(__dirname, '..')
const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const BIN = path.join(REPO, 'resources', 'tor', `${plat}-${arch}`, process.platform === 'win32' ? 'tor.exe' : 'tor')

if (!fs.existsSync(BIN)) {
  console.log(`SALTATO: binario Tor assente (${path.relative(REPO, BIN)}). Esegui prima: npm run fetch-tor`)
  process.exit(0)
}

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'm4tr1x-tor-test-'))
process.env.M4TR1X_DATA_DIR = DATA
process.env.TOR_SOCKS_PORT = process.env.TOR_SOCKS_PORT || '19050'
process.env.TOR_BINARY = BIN   // esplicito: vogliamo testare il bundled, non un Tor di sistema

const { ensureNodeTor, HOSTNAME_FILE } = require(path.join(REPO, 'server', 'tor_node.js'))

const cleanup = () => {
  try { require('child_process').execSync(`pkill -f "tor -f ${path.join(DATA, 'tor', 'torrc')}"`) } catch {}
  try { fs.rmSync(DATA, { recursive: true, force: true }) } catch {}
}

const api = http.createServer((q, r) => r.end('api')).listen(0, '127.0.0.1')
const relay = http.createServer((q, r) => r.end('relay')).listen(0, '127.0.0.1')

api.on('listening', async () => {
  let failed = null
  try {
    const apiPort = api.address().port
    const relayPort = relay.address().port

    const r = await ensureNodeTor(apiPort, relayPort)
    if (!r.ok) throw new Error('ensureNodeTor non ha portato su il SOCKS')
    if (r.external) throw new Error('ha riusato un Tor esterno: il test non prova il binario impacchettato')
    console.log('  ok  Tor impacchettato avviato, SOCKS pronto')

    const onion = fs.readFileSync(HOSTNAME_FILE, 'utf8').trim()
    if (!/^[a-z2-7]{56}\.onion$/.test(onion)) throw new Error(`onion malformato: ${onion}`)
    console.log(`  ok  onion generato (${onion.slice(0, 12)}...onion)`)

    const torrc = fs.readFileSync(path.join(DATA, 'tor', 'torrc'), 'utf8')
    if (!torrc.includes(`HiddenServicePort 80 127.0.0.1:${apiPort}`)) {
      throw new Error('il hidden service NON punta alla porta di ingresso passata')
    }
    console.log('  ok  hidden service puntato al listener di ingresso')

    console.log('\n3/3 verifiche passate — l app porta Tor con se, nessuna installazione richiesta.')
  } catch (e) {
    failed = e
  } finally {
    api.close(); relay.close(); cleanup()
    if (failed) { console.error('\nFALLITO: ' + failed.message); process.exit(1) }
    process.exit(0)
  }
})
