/**
 * Il bundle Tauri deve spedire ogni modulo che il server richiede.
 *
 * A differenza di electron-builder (che impacchetta server/ con una glob), la
 * configurazione Tauri elenca i file uno per uno: basta aggiungere un
 * require('./qualcosa') e dimenticare la riga corrispondente perche' l'app
 * costruita fallisca all'avvio con "Cannot find module" — e non se ne accorge
 * nessuno finche' non si prova un pacchetto reale.
 *
 * Questo test calcola la chiusura transitiva dei require locali a partire da
 * server/index.js (l'entry del server) e verifica che siano tutti nella lista.
 *
 *   node tests/test-tauri-resources.js
 */
'use strict'
const fs = require('fs')
const path = require('path')

const REPO = path.join(__dirname, '..')
const SRV = path.join(REPO, 'server')
const CONF = path.join(REPO, 'src-tauri', 'tauri.conf.json')

const conf = JSON.parse(fs.readFileSync(CONF, 'utf8'))
const resources = conf.bundle.resources
const shipped = new Set(
  Object.keys(resources)
    .filter(k => k.startsWith('../server/'))
    .map(k => k.replace('../server/', ''))
)

const localFiles = new Set(fs.readdirSync(SRV).filter(f => f.endsWith('.js')))

const requiresOf = file => {
  let src
  try { src = fs.readFileSync(path.join(SRV, file), 'utf8') } catch { return [] }
  const out = []
  // require('./x') e require("./x") — solo moduli locali della cartella server
  for (const m of src.matchAll(/require\(\s*['"]\.\/([A-Za-z0-9_\-]+)['"]/g)) {
    const f = m[1] + '.js'
    if (localFiles.has(f)) out.push(f)
  }
  return out
}

// chiusura transitiva da index.js
const seen = new Set()
const stack = ['index.js']
while (stack.length) {
  const f = stack.pop()
  if (seen.has(f)) continue
  seen.add(f)
  for (const dep of requiresOf(f)) if (!seen.has(dep)) stack.push(dep)
}

const missing = [...seen].filter(f => !shipped.has(f)).sort()

console.log(`  moduli raggiungibili da index.js: ${seen.size}`)
console.log(`  presenti nel bundle Tauri:        ${seen.size - missing.length}`)

if (missing.length) {
  console.error(`\nFALLITO: ${missing.length} moduli richiesti non sono spediti nel bundle Tauri.`)
  console.error('Aggiungi a src-tauri/tauri.conf.json -> bundle.resources:')
  for (const m of missing) console.error(`      "../server/${m}": "server/${m}",`)
  process.exit(1)
}

// il Tor impacchettato deve viaggiare col bundle, altrimenti niente onion
if (!Object.keys(resources).some(k => k.includes('resources/tor'))) {
  console.error('\nFALLITO: i binari Tor (resources/tor/) non sono nel bundle Tauri.')
  process.exit(1)
}
console.log('  binari Tor inclusi nel bundle:    si')

console.log('\nok — il bundle Tauri spedisce tutto il necessario.')
