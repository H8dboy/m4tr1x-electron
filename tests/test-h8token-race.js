#!/usr/bin/env node
/**
 * Tests: race condition in balance check (Audit #8)
 *
 * #8a — two concurrent transfers totalling more than the available balance:
 *        only one must succeed (or combined total must not exceed balance)
 * #8b — sequential transfers that exhaust the balance fail correctly on the second
 */
'use strict'

const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')
const os     = require('os')

// ── Minimal stubs required to load h8token in isolation ──────────────────────

// 1. Redirect DB to a temp file
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4tr1x-race-'))
process.env.M4TR1X_DATA_DIR = tmpDir

// 2. Stub h8identity so no real ML-DSA keys are needed
//    signWithUnlocked resolves with a dummy hex string
//    getUnlockedIdentity returns a fake unlocked wallet
const FAKE_ADDR   = 'H8' + 'a'.repeat(38)
const FAKE_PUBKEY = 'b'.repeat(64)

const h8idStub = {
  signWithUnlocked:    async (hash) => 'sig:' + hash.slice(0, 16),
  getUnlockedIdentity: ()  => ({ address: FAKE_ADDR, publicKey: FAKE_PUBKEY }),
  verifySignature:     async () => true,
}

require.cache[require.resolve('../server/h8identity')] = {
  id: require.resolve('../server/h8identity'),
  filename: require.resolve('../server/h8identity'),
  loaded: true,
  exports: h8idStub,
}

// 3. Stub ledger_sync so network calls are no-ops
const syncStub = {
  announceBlock:    async () => {},
  getRemoteBalance: ()      => 0,
  getRemoteHistory: ()      => [],
}
require.cache[require.resolve('../server/ledger_sync')] = {
  id: require.resolve('../server/ledger_sync'),
  filename: require.resolve('../server/ledger_sync'),
  loaded: true,
  exports: syncStub,
}

const h8 = require('../server/h8token')

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

console.log('\n=== H8Token Race Condition Tests (Audit #8) ===\n')

async function main() {
  h8.initLedger()

  // Seed a known balance by minting directly into the fake address
  // We cannot use mintTokens (requires H8_ADMIN_MINT_KEY), so call appendBlock via
  // the exported internals-free path: inject a block manually via the DB.
  // Instead: set H8_ADMIN_MINT_KEY and call mintTokens.
  process.env.H8_ADMIN_MINT_KEY = 'test-admin-key-race'
  await h8.mintTokens(FAKE_ADDR, 100, 'test-admin-key-race')

  const initialBalance = h8.getBalance(FAKE_ADDR)
  assert.strictEqual(initialBalance, 100, 'pre-condition: minted balance must be 100')
  console.log(`  (balance after mint: ${initialBalance})`)

  // ── #8a: two concurrent transfers each for 80 — total 160 > 100 ─────────────
  await test('#8a — concurrent transfers > balance: only one passes', async () => {
    // Reset: re-mint to ensure balance is 100 before the race test
    const balBefore = h8.getBalance(FAKE_ADDR)

    const DEST_A = 'H8' + 'c'.repeat(38)
    const DEST_B = 'H8' + 'd'.repeat(38)

    const p1 = h8.transfer(DEST_A, 80, 'race-tx-1').then(() => 'ok').catch(e => e.message)
    const p2 = h8.transfer(DEST_B, 80, 'race-tx-2').then(() => 'ok').catch(e => e.message)

    const [r1, r2] = await Promise.all([p1, p2])

    const successes = [r1, r2].filter(r => r === 'ok').length
    const failures  = [r1, r2].filter(r => r !== 'ok').length

    // Exactly one must succeed; the other must be rejected as insufficient balance
    assert.strictEqual(successes, 1, `expected 1 success, got ${successes} (r1=${r1}, r2=${r2})`)
    assert.strictEqual(failures,  1, `expected 1 failure,  got ${failures}`)

    // Final balance must be >= 0
    const balAfter = h8.getBalance(FAKE_ADDR)
    assert.ok(balAfter >= 0, `balance went negative: ${balAfter}`)
  })

  // ── #8b: sequential transfers correctly exhaust the balance ──────────────────
  await test('#8b — sequential transfers: second fails when balance exhausted', async () => {
    // Re-mint 50 more to have a known balance for this test
    await h8.mintTokens(FAKE_ADDR, 50, 'test-admin-key-race')
    const bal = h8.getBalance(FAKE_ADDR)
    console.log(`  (balance before sequential test: ${bal})`)

    const DEST_C = 'H8' + 'e'.repeat(38)
    const DEST_D = 'H8' + 'f'.repeat(38)

    // First: spend the full available balance
    await h8.transfer(DEST_C, bal, 'seq-tx-1')

    // Second: must fail — balance is now 0
    await assert.rejects(
      () => h8.transfer(DEST_D, 1, 'seq-tx-2'),
      /saldo/i,
      'second transfer must throw insufficient balance'
    )

    assert.strictEqual(h8.getBalance(FAKE_ADDR), 0, 'balance must be exactly 0 after exhaustion')
  })

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`)

  // Cleanup (DB file may still be held by better-sqlite3 on Windows — ignore EPERM)
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}

  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('\nFatal test error:', err.message)
  process.exit(1)
})
