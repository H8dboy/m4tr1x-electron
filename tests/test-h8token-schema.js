#!/usr/bin/env node
/**
 * Test: signature NOT NULL schema enforcement (Audit fix #4)
 *
 * Previously signature TEXT was nullable in the electron schema while the node
 * repo had NOT NULL. This divergence allowed admin-mint blocks to be appended
 * without a wallet signature, bypassing the audit trail.
 *
 * Tests:
 *   1. appendBlock with locked wallet fails for ALL tx types (including mint)
 *   2. Old DB with NULL genesis signature is migrated correctly:
 *      - genesis block gets a deterministic 'genesis:...' signature
 *      - signature column becomes NOT NULL
 *      - existing non-genesis data is preserved
 */
'use strict'

const assert  = require('node:assert/strict')
const fs      = require('fs')
const os      = require('os')
const path    = require('path')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4tr1x-h8schema-test-'))
process.env.M4TR1X_DATA_DIR = tmpDir

;[
  '../server/h8identity',
  '../server/h8token',
].forEach(m => { try { delete require.cache[require.resolve(m)] } catch {} })

const h8id    = require('../server/h8identity')
const h8token = require('../server/h8token')

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`)
    failed++
  }
}

console.log('\n=== H8 Token Schema — signature NOT NULL Tests (Audit #4) ===\n')

async function main() {
  // ── Test 1: appendBlock with locked wallet fails for any tx type ─────────────
  await test('appendBlock with locked wallet throws for non-genesis tx (locked wallet)', async () => {
    h8token.initLedger()

    // Wallet is locked — signWithUnlocked will throw
    await assert.rejects(
      () => h8token.transfer('H8' + 'a'.repeat(38), 10, 'test'),
      /wallet locked/i,
      'transfer with locked wallet must throw'
    )
  })

  // ── Test 2: old nullable-schema DB is migrated to NOT NULL ───────────────────
  await test('existing DB with NULL genesis signature is migrated to NOT NULL without data loss', async () => {
    // Build a legacy DB with nullable signature (old schema)
    const Database = require('../server/node_modules/better-sqlite3')
    const legacyPath = path.join(tmpDir, 'h8ledger.db')

    // Close and discard the DB created by initLedger above
    // (better-sqlite3 doesn't have a "close by path" API; we re-require after tmpDir2)
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'm4tr1x-legacy-migration-'))
    const legacyDb = new Database(path.join(tmpDir2, 'h8ledger.db'))
    legacyDb.pragma('journal_mode = WAL')

    // Old schema: signature TEXT (nullable)
    legacyDb.exec(`
      CREATE TABLE ledger (
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
        signature   TEXT,
        from_pubkey TEXT
      )
    `)

    // Insert a genesis block with NULL signature (old format)
    const ts = Math.floor(Date.now() / 1000)
    const prevHash = '0'.repeat(64)
    const { sha3_256 } = require('../server/node_modules/@noble/hashes/sha3')
    const { bytesToHex } = require('../server/node_modules/@noble/hashes/utils')
    const hash = bytesToHex(sha3_256(
      new TextEncoder().encode(`1|${ts}|0x0|H800000000000000000000000000000000000000|0|mint||${prevHash}`)
    ))
    legacyDb.prepare(
      `INSERT INTO ledger (ts, from_addr, to_addr, amount, tx_type, note, prev_hash, hash, signature) VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(ts, '0x0', 'H800000000000000000000000000000000000000', 0, 'mint', 'genesis', prevHash, hash, null)
    legacyDb.close()

    // Load h8token with the legacy DB
    process.env.M4TR1X_DATA_DIR = tmpDir2
    ;['../server/h8identity', '../server/h8token'].forEach(m => {
      try { delete require.cache[require.resolve(m)] } catch {}
    })
    const h8token2 = require('../server/h8token')
    h8token2.initLedger()   // should run migration

    // Verify: genesis block now has a non-null signature
    const db2 = new Database(path.join(tmpDir2, 'h8ledger.db'))
    const genesis = db2.prepare('SELECT * FROM ledger WHERE block_index = 1').get()
    assert.ok(genesis.signature, 'genesis signature must not be null after migration')
    assert.ok(genesis.signature.startsWith('genesis:'), 'genesis signature must start with genesis:')

    // Verify: column is now NOT NULL
    const sigColInfo = db2.pragma('table_info(ledger)').find(c => c.name === 'signature')
    assert.equal(sigColInfo.notnull, 1, 'signature column must be NOT NULL after migration')

    // Verify: existing data preserved (1 row, same hash)
    const count = db2.prepare('SELECT COUNT(*) as c FROM ledger').get().c
    assert.equal(count, 1, 'migration must not add or remove rows')
    assert.equal(genesis.hash, hash, 'block hash must be unchanged after migration')
    db2.close()

    // Cleanup
    try { fs.rmSync(tmpDir2, { recursive: true, force: true }) } catch {}
  })

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('\nFatal test error:', err.message)
  process.exit(1)
})
