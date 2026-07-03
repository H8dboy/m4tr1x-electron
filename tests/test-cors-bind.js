/**
 * Test A1+A2 — CORS ristretto, security headers, bind loopback.
 *
 * Verifica che:
 *   - le origini esterne vengano rifiutate (niente Access-Control-Allow-Origin)
 *   - localhost / LAN privata / .onion vengano accettate
 *   - i 5 security headers siano presenti su ogni risposta
 *   - il server sia bind su 127.0.0.1 (NON raggiungibile via IP LAN) di default
 *
 * Exit 0 se tutto passa, exit 1 al primo fail.
 */
const { spawn } = require('child_process')
const http = require('http')
const os   = require('os')
const fs   = require('fs')
const path = require('path')

const PORT     = 8766
const DATA_DIR = path.join(__dirname, '..', '.cors-tmp')

if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true })
fs.mkdirSync(DATA_DIR, { recursive: true })

function req(method, pathUrl, headers = {}, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const r = http.request({
      method, hostname: host, port: PORT, path: pathUrl, headers, timeout: 5000,
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }))
    })
    r.on('error', reject)
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')) })
    r.end()
  })
}

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { console.log('✓', msg); passed++ }
  else { console.error('✗ FAIL:', msg); failed++ }
}

async function run() {
  const env = { ...process.env, PORT: String(PORT), M4TR1X_DATA_DIR: DATA_DIR, APP_SECRET: 'a'.repeat(64) }
  const srv = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  srv.stderr.on('data', d => process.stderr.write('[srv-err] ' + d))

  for (let i = 0; i < 30; i++) {
    try { if ((await req('GET', '/health')).status === 200) break } catch {}
    await new Promise(r => setTimeout(r, 500))
  }

  try {
    // ── Security headers ─────────────────────────────────────────────────────
    const h = await req('GET', '/health')
    assert(h.status === 200, 'health 200')
    assert(h.headers['x-content-type-options'] === 'nosniff', 'header X-Content-Type-Options: nosniff')
    assert(h.headers['x-frame-options'] === 'DENY', 'header X-Frame-Options: DENY')
    assert(h.headers['referrer-policy'] === 'no-referrer', 'header Referrer-Policy: no-referrer')
    assert(/geolocation/.test(h.headers['permissions-policy'] || ''), 'header Permissions-Policy presente')

    // ── CORS: origine esterna RIFIUTATA ──────────────────────────────────────
    const evil = await req('GET', '/health', { Origin: 'https://evil.example.com' })
    assert(evil.headers['access-control-allow-origin'] === undefined,
      'origine esterna rifiutata (nessun Access-Control-Allow-Origin)')

    // ── CORS: origini legittime ACCETTATE ────────────────────────────────────
    const local = await req('GET', '/health', { Origin: 'http://localhost:8080' })
    assert(local.headers['access-control-allow-origin'] === 'http://localhost:8080',
      'origine localhost accettata')

    const lan = await req('GET', '/health', { Origin: 'http://192.168.1.50:8080' })
    assert(lan.headers['access-control-allow-origin'] === 'http://192.168.1.50:8080',
      'origine LAN privata accettata')

    const onion = await req('GET', '/health', { Origin: 'http://abcd1234.onion' })
    assert(onion.headers['access-control-allow-origin'] === 'http://abcd1234.onion',
      'origine .onion accettata')

    // ── A2: bind su loopback — NON raggiungibile via IP LAN ───────────────────
    const lanIp = Object.values(os.networkInterfaces()).flat()
      .find(n => n && n.family === 'IPv4' && !n.internal)?.address
    if (lanIp) {
      let reachable = false
      try { reachable = (await req('GET', '/health', {}, lanIp)).status === 200 } catch { reachable = false }
      assert(!reachable, `server NON raggiungibile via IP LAN ${lanIp} (bind 127.0.0.1)`)
    } else {
      console.log('• skip test bind LAN: nessuna interfaccia LAN rilevata')
    }

    console.log(`\nResults: ${passed} passed, ${failed} failed`)
    process.exit(failed === 0 ? 0 : 1)
  } catch (e) {
    console.error('✗ ERROR:', e.message)
    process.exit(1)
  } finally {
    srv.kill('SIGTERM')
    setTimeout(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }) } catch {} }, 500)
  }
}

run()
