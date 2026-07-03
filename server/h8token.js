/**
 * M4TR1X — H8 Token Ledger
 * Hash chain SHA3-256, firme ML-DSA65 via h8identity.
 * Token utility closed-credit stile Twitch Bits — fuori perimetro MiCA.
 */

const Database  = require('better-sqlite3')
const crypto    = require('crypto')
const path      = require('path')
const h8id      = require('./h8identity')
const { sha3_256 } = require('@noble/hashes/sha3')
const { bytesToHex } = require('@noble/hashes/utils')

// Lazy import per evitare cicli: ledger_sync richiede nostr che richiede fs ecc.
let _sync = null
function getSync() {
  if (!_sync) _sync = require('./ledger_sync')
  return _sync
}

// Lazy import del session guard (mitigazione: una sola sessione attiva per identità).
let _guard = null
function getGuard() {
  if (!_guard) { try { _guard = require('./session_guard') } catch { _guard = { hasConflict: () => false } } }
  return _guard
}

// Rifiuta la spesa se è stata rilevata una sessione concorrente per la stessa identità.
function assertNoSessionConflict(address) {
  try {
    if (getGuard().hasConflict(address))
      throw new Error('Sessione concorrente rilevata per questa identità — spese sospese. Blocca l\'identità sugli altri nodi.')
  } catch (e) {
    if (/Sessione concorrente/.test(e.message)) throw e   // rilancia solo il nostro errore
  }
}

const MINT_ADDRESS     = process.env.H8_MINT_ADDRESS     || 'H8' + '0'.repeat(38)
const PLATFORM_ADDRESS = process.env.H8_PLATFORM_ADDRESS || 'H8' + '1'.repeat(38)
const SERVER_ADDRESS   = process.env.H8_SERVER_ADDRESS   || 'H8' + '2'.repeat(38)

// Mitigazione lancio (pre-head canonico): tetto ai fondi NON confermati rispendibili
// subito. Fino a MAX_UNCONFIRMED di entrate fresche è spendibile all'istante (UX tip),
// oltre bisogna aspettare la finestra di conferma. Configurabile via H8_MAX_UNCONFIRMED.
const MAX_UNCONFIRMED = Math.max(0, parseInt(process.env.H8_MAX_UNCONFIRMED || '1000'))

const VALID_TX_TYPES = new Set([
  'mint', 'transfer',
  'tip_creator', 'tip_platform', 'tip_server',
  'boost',
  'shop_seller', 'shop_platform', 'shop_server',
])

let _db = null

function getDbPath() {
  try { return path.join(require('electron').app.getPath('userData'), 'h8ledger.db') }
  catch { return path.join(process.env.M4TR1X_DATA_DIR || process.cwd(), 'h8ledger.db') }
}

function getDb() {
  if (!_db) _db = new Database(getDbPath())
  return _db
}

function hashBlock(idx, ts, from, to, amount, type, contentId, prevHash) {
  const input = `${idx}|${ts}|${from}|${to}|${amount}|${type}|${contentId||''}|${prevHash}`
  return bytesToHex(sha3_256(new TextEncoder().encode(input)))
}

function validAddress(addr) {
  if (!addr || typeof addr !== 'string') return false
  if (/^H8[0-9a-f]{38}$/.test(addr)) return true
  if (/^nostr_[0-9a-f]{38}$/.test(addr)) return true
  return addr === '0x0'
}

function initLedger() {
  const db = getDb()
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger (
      block_index INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          INTEGER NOT NULL,
      from_addr   TEXT NOT NULL,
      to_addr     TEXT NOT NULL,
      amount      INTEGER NOT NULL,
      tx_type     TEXT NOT NULL,
      content_id  TEXT,
      note        TEXT,
      prev_hash   TEXT NOT NULL,
      hash        TEXT NOT NULL,
      signature   TEXT NOT NULL,
      from_pubkey TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_from    ON ledger(from_addr);
    CREATE INDEX IF NOT EXISTS idx_to      ON ledger(to_addr);
    CREATE INDEX IF NOT EXISTS idx_content ON ledger(content_id);
    CREATE INDEX IF NOT EXISTS idx_ts      ON ledger(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_type    ON ledger(tx_type);
  `)

  // Migration (audit #3): add from_pubkey column to existing databases
  const cols = db.pragma('table_info(ledger)')
  if (!cols.some(c => c.name === 'from_pubkey')) {
    db.exec('ALTER TABLE ledger ADD COLUMN from_pubkey TEXT')
    console.log('[H8] Migration: ledger.from_pubkey column added for ML-DSA signature verification')
  }

  // Migration (audit #4): enforce signature NOT NULL — align with node repo schema
  const sigCol = db.pragma('table_info(ledger)').find(c => c.name === 'signature')
  if (sigCol && sigCol.notnull === 0) {
    // Fix genesis blocks that have NULL signature → deterministic 'genesis:...' value
    const nullGenesis = db.prepare(
      `SELECT block_index, hash FROM ledger WHERE signature IS NULL AND tx_type = 'mint' AND from_addr = '0x0'`
    ).all()
    for (const b of nullGenesis) {
      const sig = 'genesis:' + bytesToHex(sha3_256(new TextEncoder().encode(b.hash)))
      db.prepare('UPDATE ledger SET signature = ? WHERE block_index = ?').run(sig, b.block_index)
    }

    // Abort if any non-genesis block still has NULL signature — cannot auto-fix
    const remaining = db.prepare(
      `SELECT block_index, tx_type, from_addr FROM ledger WHERE signature IS NULL`
    ).all()
    if (remaining.length > 0) {
      console.error('[H8] CRITICAL: non-genesis blocks with NULL signature:', remaining)
      throw new Error(
        `Ledger has ${remaining.length} non-genesis block(s) with NULL signature — manual intervention required`
      )
    }

    // Recreate table with NOT NULL constraint (SQLite does not support ALTER COLUMN)
    db.transaction(() => {
      db.exec(`CREATE TABLE ledger_new (
        block_index INTEGER PRIMARY KEY AUTOINCREMENT,
        ts          INTEGER NOT NULL,
        from_addr   TEXT NOT NULL,
        to_addr     TEXT NOT NULL,
        amount      INTEGER NOT NULL,
        tx_type     TEXT NOT NULL,
        content_id  TEXT,
        note        TEXT,
        prev_hash   TEXT NOT NULL,
        hash        TEXT NOT NULL,
        signature   TEXT NOT NULL,
        from_pubkey TEXT
      )`)
      db.exec('INSERT INTO ledger_new SELECT * FROM ledger')
      db.exec('DROP TABLE ledger')
      db.exec('ALTER TABLE ledger_new RENAME TO ledger')
      db.exec('CREATE INDEX IF NOT EXISTS idx_from    ON ledger(from_addr)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_to      ON ledger(to_addr)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_content ON ledger(content_id)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_ts      ON ledger(ts DESC)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_type    ON ledger(tx_type)')
    })()
    console.log('[H8] Migration: signature column is now NOT NULL (audit #4)')
  }

  const count = db.prepare('SELECT COUNT(*) as c FROM ledger').get().c
  if (count === 0) {
    const ts = Math.floor(Date.now()/1000)
    const prevHash = '0'.repeat(64)
    const hash = hashBlock(1, ts, '0x0', MINT_ADDRESS, 0, 'mint', null, prevHash)
    const genesisSig = 'genesis:' + bytesToHex(sha3_256(new TextEncoder().encode(hash)))
    db.prepare(`INSERT INTO ledger (ts, from_addr, to_addr, amount, tx_type, content_id, note, prev_hash, hash, signature, from_pubkey) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ts, '0x0', MINT_ADDRESS, 0, 'mint', null, 'genesis', prevHash, hash, genesisSig, null)
    console.log('[H8] Ledger genesis block created.')
  }
}

function getLastBlock() {
  return getDb().prepare('SELECT * FROM ledger ORDER BY block_index DESC LIMIT 1').get()
}

// Per-sender serialization queue — prevents concurrent transfers from the same
// address racing through the balance check before either one commits (audit #8).
// Node.js is single-threaded but async signing yields control to the event loop,
// creating the race window. SQLite transactions can't span async operations, so
// we serialize at the application level instead.
const _senderLocks = new Map()

function withSenderLock(address, fn) {
  const prev = _senderLocks.get(address) || Promise.resolve()
  let unlock
  const done = new Promise(r => { unlock = r })
  // Register synchronously (before any await) so the next caller chains on us
  _senderLocks.set(address, done)
  return prev
    .then(() => fn())
    .finally(() => {
      unlock()
      if (_senderLocks.get(address) === done) _senderLocks.delete(address)
    })
}

async function appendBlock({ from, to, amount, tx_type, content_id = null, note = null }) {
  if (!validAddress(from) || !validAddress(to)) throw new Error('Invalid address format')
  if (!VALID_TX_TYPES.has(tx_type)) throw new Error('Invalid tx_type')
  if (!Number.isInteger(amount) || amount < 0) throw new Error('amount must be non-negative integer (centesimi H8)')

  // Guardia saldo-negativo (audit): nessuna spesa può portare il mittente sotto zero.
  // Esente il mint (from '0x0'). Difesa in profondità: gira dentro il lock per-sender,
  // così spese concorrenti non possono superarla in gara.
  if (from !== '0x0' && getBalance(from) < amount)
    throw new Error('Saldo insufficiente')

  const db = getDb()
  const last = getLastBlock()
  const idx = (last ? last.block_index : 0) + 1
  const ts  = Math.floor(Date.now() / 1000)
  const prevHash = last ? last.hash : '0'.repeat(64)
  const hash = hashBlock(idx, ts, from, to, amount, tx_type, content_id, prevHash)

  let signature
  let fromPubkey = null
  try {
    signature = await h8id.signWithUnlocked(hash)
    const unlocked = h8id.getUnlockedIdentity()
    fromPubkey = unlocked ? unlocked.publicKey : null
  } catch (e) {
    throw new Error('H8 wallet locked: cannot sign transaction')
  }

  db.prepare(`INSERT INTO ledger (ts, from_addr, to_addr, amount, tx_type, content_id, note, prev_hash, hash, signature, from_pubkey) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(ts, from, to, amount, tx_type, content_id, note, prevHash, hash, signature, fromPubkey)

  const block = { block_index: idx, ts, from_addr: from, to_addr: to, amount, tx_type, content_id, hash, signature, signer_pubkey: fromPubkey }

  // Annuncia il blocco alla rete in background (non bloccante)
  if (signature && fromPubkey) {
    setImmediate(() => getSync().announceBlock(block).catch(() => {}))
  }

  return block
}

function getBalance(address) {
  if (!validAddress(address)) return 0
  const db = getDb()
  const localIn  = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM ledger WHERE to_addr = ?').get(address).s
  const localOut = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM ledger WHERE from_addr = ?').get(address).s
  const localBal = localIn - localOut

  // Includi transazioni verificate da altri nodi
  let remoteBal = 0
  try { remoteBal = getSync().getRemoteBalance(address) } catch {}

  return localBal + remoteBal
}

// ─── Saldo spendibile (mitigazioni lancio) ────────────────────────────────────
// Saldo spendibile ORA: totale meno la quota di entrate remote ancora "in attesa"
// che eccede il tetto MAX_UNCONFIRMED. Il saldo locale (genesi/mint/proprie uscite)
// è sempre confermato. È questo — non getBalance — che governa i controlli di spesa.
function getSpendable(address) {
  if (!validAddress(address)) return 0
  const total = getBalance(address)
  let pending = 0
  try { pending = getSync().getRemoteBalances(address).pending } catch {}
  const withheld = Math.max(pending - MAX_UNCONFIRMED, 0)
  return total - withheld
}

// Breakdown per UI/diagnostica: { total, spendable, pending_unconfirmed }.
function getBalanceBreakdown(address) {
  const total = getBalance(address)
  let pending = 0
  try { pending = getSync().getRemoteBalances(address).pending } catch {}
  return {
    total,
    spendable: total - Math.max(pending - MAX_UNCONFIRMED, 0),
    pending_unconfirmed: Math.max(pending, 0),
  }
}

function getHistory(address, limit = 50) {
  if (!validAddress(address)) return []
  const local = getDb().prepare(`
    SELECT block_index, ts, from_addr, to_addr, amount, tx_type, content_id, note, hash,
           'local' AS source
    FROM ledger WHERE from_addr = ? OR to_addr = ? ORDER BY ts DESC LIMIT ?
  `).all(address, address, limit)

  let remote = []
  try { remote = getSync().getRemoteHistory(address, limit) } catch {}

  // Merge e dedup per hash, ordina per ts
  const seen = new Set(local.map(b => b.hash))
  const merged = [
    ...local,
    ...remote.filter(b => !seen.has(b.hash)),
  ].sort((a, b) => b.ts - a.ts).slice(0, limit)

  return merged
}

async function transfer(to, amount, note = '') {
  const unlocked = h8id.getUnlockedIdentity()
  if (!unlocked) throw new Error('H8 wallet locked')
  const from = unlocked.address
  return withSenderLock(from, async () => {
    assertNoSessionConflict(from)
    if (getSpendable(from) < amount) throw new Error('Saldo insufficiente')
    return appendBlock({ from, to, amount, tx_type: 'transfer', note })
  })
}

async function tip(creatorAddr, amount, contentId) {
  const unlocked = h8id.getUnlockedIdentity()
  if (!unlocked) throw new Error('H8 wallet locked')
  const from = unlocked.address
  return withSenderLock(from, async () => {
    assertNoSessionConflict(from)
    if (getSpendable(from) < amount) throw new Error('Saldo insufficiente per tip')

    const creatorShare  = Math.floor(amount * 0.50)
    const platformShare = Math.floor(amount * 0.20)
    const serverShare   = amount - creatorShare - platformShare

    const b1 = await appendBlock({ from, to: creatorAddr,      amount: creatorShare,  tx_type: 'tip_creator',  content_id: contentId })
    const b2 = await appendBlock({ from, to: PLATFORM_ADDRESS, amount: platformShare, tx_type: 'tip_platform', content_id: contentId })
    const b3 = await appendBlock({ from, to: SERVER_ADDRESS,   amount: serverShare,   tx_type: 'tip_server',   content_id: contentId })
    return { creator: b1, platform: b2, server: b3, total: amount }
  })
}

async function boost(contentId, amount) {
  const unlocked = h8id.getUnlockedIdentity()
  if (!unlocked) throw new Error('H8 wallet locked')
  const from = unlocked.address
  return withSenderLock(from, async () => {
    assertNoSessionConflict(from)
    if (getSpendable(from) < amount) throw new Error('Saldo insufficiente per boost')
    return appendBlock({ from, to: PLATFORM_ADDRESS, amount, tx_type: 'boost', content_id: contentId })
  })
}

function getBoostScore(contentId) {
  const r = getDb().prepare(`SELECT COALESCE(SUM(amount),0) as s FROM ledger WHERE content_id = ? AND tx_type = 'boost'`).get(contentId)
  return r.s
}

const SQLITE_VAR_LIMIT = 999

function getBoostScoresBatch(ids) {
  if (!ids || !ids.length) return {}
  const result = {}
  ids.forEach(id => { result[id] = 0 })
  const db = getDb()
  for (let i = 0; i < ids.length; i += SQLITE_VAR_LIMIT) {
    const chunk = ids.slice(i, i + SQLITE_VAR_LIMIT)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db.prepare(`SELECT content_id, COALESCE(SUM(amount),0) as s FROM ledger WHERE tx_type = 'boost' AND content_id IN (${placeholders}) GROUP BY content_id`).all(...chunk)
    rows.forEach(r => { result[r.content_id] = r.s })
  }
  return result
}

async function verifyChain() {
  const rows = getDb().prepare('SELECT * FROM ledger ORDER BY block_index ASC').all()
  let expectedPrev = '0'.repeat(64)
  const warnings = []

  for (const b of rows) {
    if (b.prev_hash !== expectedPrev)
      return { valid: false, firstInvalidBlock: b.block_index, reason: 'prev_hash mismatch' }

    const recomputed = hashBlock(b.block_index, b.ts, b.from_addr, b.to_addr, b.amount, b.tx_type, b.content_id, b.prev_hash)
    if (recomputed !== b.hash)
      return { valid: false, firstInvalidBlock: b.block_index, reason: 'hash mismatch' }

    // Genesis block: mint from 0x0 with no signature — skip ML-DSA verification
    if (b.tx_type === 'mint' && b.from_addr === '0x0') {
      expectedPrev = b.hash
      continue
    }

    if (!b.signature)
      return { valid: false, firstInvalidBlock: b.block_index, reason: 'missing signature on non-genesis block' }

    if (!b.from_pubkey) {
      // Block predates audit fix #3 migration — hash is intact but signature unverifiable
      warnings.push({ block: b.block_index, reason: 'from_pubkey missing — ML-DSA signature not verifiable' })
    } else {
      const sigOk = await h8id.verifySignature(b.from_pubkey, b.hash, b.signature)
      if (!sigOk)
        return { valid: false, firstInvalidBlock: b.block_index, reason: 'invalid ML-DSA signature' }
    }

    expectedPrev = b.hash
  }

  const result = { valid: true, blocks: rows.length }
  if (warnings.length) result.warnings = warnings
  return result
}

function mintTokens(to, amount, adminKey) {
  // Mint resta controllato da chiave admin (P8): mai aperto. Autorità = mint key
  // dedicata (H8_ADMIN_MINT_KEY) se impostata, altrimenti la ADMIN_KEY del server
  // (sempre presente). Prima, senza H8_ADMIN_MINT_KEY il mint era sempre disabilitato
  // anche con una ADMIN_KEY valida — comportamento sorprendente, ora rimosso.
  const expectedKey = process.env.H8_ADMIN_MINT_KEY || process.env.ADMIN_KEY
  if (!expectedKey) throw new Error('Nessuna chiave admin configurata — mint disabilitato')
  if (!adminKey || adminKey !== expectedKey) throw new Error('Chiave admin non valida')
  if (!validAddress(to)) throw new Error('Invalid recipient address')
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount positive integer required')
  console.log(`[H8] Mint autorizzato: ${amount} → ${to}`)
  return appendBlock({ from: '0x0', to, amount, tx_type: 'mint', note: 'admin_mint' })
}

module.exports = {
  initLedger, getBalance, getSpendable, getBalanceBreakdown, getHistory,
  transfer, tip, boost,
  getBoostScore, getBoostScoresBatch, verifyChain, mintTokens,
  MINT_ADDRESS, PLATFORM_ADDRESS, SERVER_ADDRESS,
}
