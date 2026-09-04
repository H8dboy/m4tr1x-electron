/**
 * Un visitatore .onion NON deve essere scambiato per il proprietario.
 *
 * Un hidden service consegna le connessioni tramite il Tor locale: chi arriva
 * dall'onion ha remoteAddress 127.0.0.1, identico a chi e' seduto davanti al PC.
 * La difesa e' il listener di ingresso dedicato (startTorIngress), che marca ogni
 * socket _m4Public; l'onion punta LI', mai alla porta principale.
 *
 * Questo test riproduce esattamente quel meccanismo e verifica le quattro
 * condizioni che contano. Non serve express: _isLocalReq guarda solo
 * req.socket e req.headers, che il modulo http fornisce identici.
 *
 *   node tests/test-tor-ingress.js
 */
'use strict'
const http = require('http')
const assert = require('assert')

// ─── Logica sotto test: copia fedele di server/index.js ──────────────────────
const _PROXY_HDRS = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip', 'x-client-ip']
let LOOPBACK_OWNER = true
const _isLoopbackIp = ip => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
function _isLocalReq(req) {
  if (!LOOPBACK_OWNER) return false
  const sock = req.socket
  if (!sock || sock._m4Public) return false
  for (const h of _PROXY_HDRS) if (req.headers[h]) return false
  return _isLoopbackIp(sock.remoteAddress || '')
}

const handler = (req, res) => {
  res.end(JSON.stringify({ owner: _isLocalReq(req) }))
}

function listen(srv, host = '127.0.0.1') {
  return new Promise(r => srv.listen(0, host, () => r(srv.address().port)))
}
function get(port, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/', headers }, res => {
      let b = ''
      res.on('data', d => b += d)
      res.on('end', () => resolve(JSON.parse(b)))
    }).on('error', reject)
  })
}

;(async () => {
  // Porta principale: quella su cui digita il proprietario.
  const main = http.createServer(handler)
  // Ingresso Tor: stessa app, ogni socket marcato _m4Public.
  const ingress = http.createServer(handler)
  ingress.on('connection', s => { s._m4Public = true })

  const mainPort = await listen(main)
  const ingressPort = await listen(ingress)

  let ok = 0
  const check = (name, cond) => {
    assert.ok(cond, `FALLITO: ${name}`)
    console.log(`  ok  ${name}`)
    ok++
  }

  // 1. Il proprietario, sulla porta principale, resta proprietario.
  check('proprietario su porta principale = owner',
    (await get(mainPort)).owner === true)

  // 2. IL TEST CHE CONTA: chi arriva dall'onion (ingresso Tor) NON e' owner,
  //    pur avendo lo stesso identico IP 127.0.0.1.
  check('visitatore .onion (ingresso Tor) NON e owner',
    (await get(ingressPort)).owner === false)

  // 3. Header di proxy: qualcuno davanti al server -> niente privilegio.
  for (const h of _PROXY_HDRS) {
    check(`header di proxy "${h}" annulla il privilegio`,
      (await get(mainPort, { [h]: '1.2.3.4' })).owner === false)
  }

  // 4. Interruttore generale.
  LOOPBACK_OWNER = false
  check('LOOPBACK_OWNER=0 disattiva il privilegio ovunque',
    (await get(mainPort)).owner === false)
  LOOPBACK_OWNER = true

  main.close(); ingress.close()
  console.log(`\n${ok}/${ok} verifiche passate — l'onion non eredita i privilegi del loopback.`)
})().catch(e => { console.error('\n' + e.message); process.exit(1) })
