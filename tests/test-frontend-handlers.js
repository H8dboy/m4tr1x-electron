/**
 * Test statico dei handler frontend dopo la migrazione a delega (B2).
 * Avrebbe intercettato subito il bug in cui la migrazione scriveva `data-action="$1"`
 * (placeholder letterale) invece del nome funzione.
 * Verifica: nessun handler inline reale; nessun placeholder $N; ogni data-action /
 * data-close / data-on* risolve a una funzione globale o a un override del dispatcher.
 */
const fs = require('fs')
const path = require('path')

// Rimuovi i commenti HTML: il browser li ignora, e la doc del dispatcher contiene
// esempi tipo data-action="fn" che non sono handler reali.
const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
let pass = 0, fail = 0
const A = (c, m) => { if (c) { console.log('✓', m); pass++ } else { console.error('✗ FAIL:', m); fail++ } }

// 1. Nessun handler inline reale (on* attributi HTML, non le proprietà JS .onclick=)
A(!/[ "']on(click|input|change)="/.test(html), '0 handler inline on* reali')

// 2. Nessun placeholder di migrazione rimasto
A(!/data-(action|args|close)="\$[0-9]/.test(html), '0 placeholder $N in data-*')

// Chiavi degli override del dispatcher (ACTIONS + INPUTS: `nome:(...)=>`)
const disp = (html.match(/<script>\s*\(function\(\)\{[\s\S]*?window\.__deleg[\s\S]*?<\/script>/) || [''])[0]
const overrides = new Set([...disp.matchAll(/(\w+):\(/g)].map(m => m[1]))
// Funzioni globali definite nel file
const funcs = new Set([...html.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]))
const resolves = (n, set = funcs) => set.has(n) || overrides.has(n)

// 3. Ogni data-action risolve
const da = new Set([...html.matchAll(/data-action="([A-Za-z_$][\w$]*)"/g)].map(m => m[1]))
const badDA = [...da].filter(v => !resolves(v))
A(badDA.length === 0, `ogni data-action risolve (${da.size} distinti)` + (badDA.length ? ' — MANCANTI: ' + badDA.join(', ') : ''))

// 4. Ogni data-close risolve a funzione
const dc = new Set([...html.matchAll(/data-close="([A-Za-z_$][\w$]*)"/g)].map(m => m[1]))
const badDC = [...dc].filter(v => !funcs.has(v))
A(badDC.length === 0, `ogni data-close risolve (${dc.size})` + (badDC.length ? ' — MANCANTI: ' + badDC.join(', ') : ''))

// 5. Ogni data-oninput/onchange risolve
const di = new Set([...html.matchAll(/data-on(?:input|change)="([A-Za-z_$][\w$]*)"/g)].map(m => m[1]))
const badDI = [...di].filter(v => !resolves(v))
A(badDI.length === 0, `ogni data-oninput/onchange risolve (${di.size})` + (badDI.length ? ' — MANCANTI: ' + badDI.join(', ') : ''))

console.log(`\nResults: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
