#!/usr/bin/env node
/**
 * Test: verifyChain ML-DSA signature verification (Audit fix #3)
 *
 * Previously verifyChain() only checked hash integrity; it did not call
 * verifySignature() on ML-DSA block signatures. A ledger with valid hashes
 * but fake signatures passed verification — this is the bug being fixed.
 *
 * Tests:
 *   1. Valid chain (all ML-DSA signatures correct) passes verifyChain
 *   2. Tampered ML-DSA signature on a non-genesis block is detected
 *   3. from_pubkey stored in block matches the signer's H8 address derivation
 *
 * NOTE: scrypt(N=131072) is used in h8identity — each test that calls
 * generateIdentity/unlockIdentity will take ~1-2 seconds. Total ~3-4s.
 */
'use strict'

const assert   = require('node:assert/strict')
const fs       = require('fs')
const os       = require('os')
const path     = require('path')

// ── Isolated temp directory ───────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4tr1x-h8token-test-'))
process.env.M4TR1X_DATA_DIR = tmpDir
// Il mint richiede una chiave admin (P8). Il focus del test è verifyChain, non l'auth
// del mint: configuriamo una chiave di test e passiamola al mint (che è solo setup).
process.env.H8_ADMIN_MINT_KEY = 'test-mint-key'

// Force fresh module loads with isolated state
;[
  '../server/h8identity',
  '../server/h8token',
].forEach(m => { try { delete require.cache[require.resolve(m)] } catch {} })

const h8id    = require('../server/h8identity')
const h8token = require('../server/h8token')

let passed = 0
let failed = 0

async function test (name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`)
    failed++
  }
}

console.log('\n=== H8 Token verifyChain Signature Verification Tests (Audit #3) ===')
console.log('    (note: scrypt key derivation ~1-2s per identity operation)\n')

async function main () {
  // ── Setup: create test identity and a minimal ledger ─────────────────────
  await h8id.generateIdentity('audit3-test')
  await h8id.unlockIdentity('audit3-test')
  h8token.initLedger()

  const unlocked = h8id.getUnlockedIdentity()
  const testAddr = 'H8' + 'a'.repeat(38)

  // Mint tokens to the unlocked identity so transfer is possible
  await h8token.mintTokens(unlocked.address, 1000, 'test-mint-key')
  // Transfer creates a signed (ML-DSA) block with from_pubkey stored
  await h8token.transfer(testAddr, 100, 'audit-test-transfer')

  // ── Test 1: valid chain passes verifyChain ────────────────────────────────
  await test('valid chain with correct ML-DSA signatures passes verifyChain', async () => {
    const result = await h8token.verifyChain()
    assert.ok(result.valid, `Chain should be valid. Got: ${JSON.stringify(result)}`)
    assert.ok(result.blocks >= 2, 'Should have at least genesis + transfer block')
  })

  // ── Test 2: tampered ML-DSA signature is detected (original bug prevention)
  await test('tampered ML-DSA signature on a block is detected — original bug prevention', async () => {
    const Database = require('../server/node_modules/better-sqlite3')
    const db2 = new Database(path.join(tmpDir, 'h8ledger.db'))

    // Find a block with a real ML-DSA signature (has from_pubkey, not genesis)
    // Un blocco firmato NON-mint: i blocchi mint (from '0x0') sono genesis-like e
    // verifyChain ne salta la verifica firma per design, quindi puntiamo al transfer.
    const signed = db2.prepare(
      "SELECT block_index, signature FROM ledger WHERE from_pubkey IS NOT NULL AND tx_type = 'transfer' LIMIT 1"
    ).get()

    assert.ok(signed, 'Test ledger must have at least one ML-DSA signed block')

    // Flip the last two hex chars of the signature to corrupt it
    const lastTwo = signed.signature.slice(-2)
    const flipped = lastTwo === '00' ? 'ff' : '00'
    db2.prepare('UPDATE ledger SET signature = ? WHERE block_index = ?')
       .run(signed.signature.slice(0, -2) + flipped, signed.block_index)
    db2.close()

    const result = await h8token.verifyChain()
    assert.ok(!result.valid, 'Chain with tampered signature should be invalid')
    assert.equal(result.firstInvalidBlock, signed.block_index, 'Must report the correct invalid block')
    assert.equal(result.reason, 'invalid ML-DSA signature', 'Must report the ML-DSA reason')
  })

  // ── Test 3: from_pubkey in block corresponds to the correct signing address ─
  await test('from_pubkey stored in block correctly corresponds to from_addr', async () => {
    const Database = require('../server/node_modules/better-sqlite3')
    const db2 = new Database(path.join(tmpDir, 'h8ledger.db'))

    const signed = db2.prepare(
      "SELECT from_addr, from_pubkey FROM ledger WHERE from_pubkey IS NOT NULL AND tx_type = 'transfer' LIMIT 1"
    ).get()
    db2.close()

    assert.ok(signed, 'Test ledger must have at least one block with from_pubkey')

    // Verify that H8AddressFrom(from_pubkey) === from_addr
    // This proves the correct pubkey is stored — a substituted pubkey would produce a different address
    const derivedAddr = h8id.h8AddressFrom(signed.from_pubkey)
    assert.equal(derivedAddr, signed.from_addr,
      'from_pubkey must derive to from_addr — prevents pubkey substitution attack')
  })

  // ── Cleanup ───────────────────────────────────────────────────────────────
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('\nFatal test error:', err.message)
  process.exit(1)
})
