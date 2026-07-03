/**
 * Quick-win D — verifica di comportamento:
 *   D2: /api/v1/admin/reload ora richiede admin key (prima era aperto).
 *   D3: mint funziona con la sola ADMIN_KEY, senza H8_ADMIN_MINT_KEY
 *       (prima era sempre disabilitato — comportamento sorprendente).
 * Exit 0 se tutto passa, exit 1 al primo fail.
 */
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 8768
const BASE = `http://localhost:${PORT}`
const DATA_DIR = path.join(__dirname, '..', '.dfix-tmp')
const ADMIN = 'dfix_admin_' + Math.random().toString(36).slice(2, 10)
const PASS = 'dfixpass1234'

if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true })
fs.mkdirSync(DATA_DIR, { recursive: true })

function req(method, pathUrl, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + pathUrl)
    const r = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...headers }, timeout: 5000,
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }) } catch { resolve({ status: res.statusCode, body: d }) } })
    })
    r.on('error', reject)
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')) })
    if (body) r.write(JSON.stringify(body))
    r.end()
  })
}

let passed = 0, failed = 0
function assert(cond, msg) { if (cond) { console.log('✓', msg); passed++ } else { console.error('✗ FAIL:', msg); failed++ } }

async function run() {
  // NB: ADMIN_KEY impostata, H8_ADMIN_MINT_KEY deliberatamente ASSENTE
  const env = {
    ...process.env,
    PORT: String(PORT),
    ADMIN_KEY: ADMIN,
    APP_SECRET: 'b'.repeat(64),
    M4TR1X_DATA_DIR: DATA_DIR,
  }
  delete env.H8_ADMIN_MINT_KEY
  const srv = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  srv.stderr.on('data', d => process.stderr.write('[srv-err] ' + d))

  for (let i = 0; i < 30; i++) {
    try { if ((await req('GET', '/health')).status === 200) break } catch {}
    await new Promise(r => setTimeout(r, 500))
  }

  try {
    assert((await req('GET', '/health')).status === 200, 'health 200')

    // ── D2: /admin/reload senza chiave → 401 ──────────────────────────────────
    const noKey = await req('POST', '/api/v1/admin/reload', {})
    assert(noKey.status === 401, `D2: reload senza admin key rifiutato (${noKey.status})`)

    // ── D3: mint con la sola ADMIN_KEY (nessuna H8_ADMIN_MINT_KEY) ─────────────
    const create = await req('POST', '/api/v1/h8/wallet/create', { password: PASS })
    assert(create.status === 201, `wallet create (${create.status})`)
    const addr = create.body.address
    assert((await req('POST', '/api/v1/h8/wallet/unlock', { password: PASS })).status === 200, 'unlock')

    const mint = await req('POST', '/api/v1/admin/h8/mint',
      { toAddress: addr, amount: 5000 }, { 'x-admin-key': ADMIN })
    assert(mint.status === 200, `D3: mint con sola ADMIN_KEY riesce (${mint.status} ${JSON.stringify(mint.body).slice(0,60)})`)
    assert((await req('GET', '/api/v1/h8/balance')).body.balance === 5000, 'D3: saldo dopo mint = 5000')

    // ── D3 controprova: mint con chiave sbagliata → errore ────────────────────
    const badMint = await req('POST', '/api/v1/admin/h8/mint',
      { toAddress: addr, amount: 5000 }, { 'x-admin-key': 'chiave-sbagliata' })
    assert(badMint.status === 401, `D3: mint con admin key errata rifiutato (${badMint.status})`)

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
