#!/usr/bin/env node
/**
 * Tests: ai_detector path traversal + resource exhaustion (Audit #7)
 *
 * #7a — path with ../../ traversal is rejected
 * #7b — file exceeding 500 MB limit is rejected
 * #7c — a valid path inside the allowed uploads directory is accepted
 */
'use strict'

const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')
const os     = require('os')

const { validateVideoPath } = require('../server/ai_detector')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`)
    failed++
  }
}

console.log('\n=== AI Detector Path Traversal + Resource Exhaustion Tests (Audit #7) ===\n')

// ── Temporary test directory & file ──────────────────────────────────────────
const tmpUploads = fs.mkdtempSync(path.join(os.tmpdir(), 'm4tr1x-ai-test-'))
const validFile  = path.join(tmpUploads, 'sample.mp4')
fs.writeFileSync(validFile, Buffer.alloc(1024))  // 1 KB dummy file

// ── #7a: path traversal is rejected ──────────────────────────────────────────
test('#7a — traversal path (../../etc/passwd) is rejected', () => {
  const traversalPath = path.join(tmpUploads, '..', '..', 'etc', 'passwd')
  // Provide a safe allowedDir — the traversal should escape it
  assert.throws(
    () => validateVideoPath(traversalPath, tmpUploads),
    /traversal|outside/i,
    'validateVideoPath must throw on path traversal attempt'
  )
})

test('#7a — absolute path outside allowed dir is rejected', () => {
  const outsidePath = path.join(os.tmpdir(), 'evil.mp4')
  fs.writeFileSync(outsidePath, Buffer.alloc(512))
  try {
    assert.throws(
      () => validateVideoPath(outsidePath, tmpUploads),
      /traversal|outside/i,
      'validateVideoPath must throw when path escapes allowed dir'
    )
  } finally {
    fs.unlinkSync(outsidePath)
  }
})

// ── #7b: file > 500 MB is rejected ───────────────────────────────────────────
test('#7b — file exceeding 500 MB limit is rejected', () => {
  // Mock statSync to return a size > 500 MB without creating a real 500 MB file
  const origStat = fs.statSync
  fs.statSync = (p) => {
    if (p === path.resolve(validFile)) return { size: 501 * 1024 * 1024 }
    return origStat(p)
  }
  try {
    assert.throws(
      () => validateVideoPath(validFile, tmpUploads),
      /too large|500/i,
      'validateVideoPath must throw when file exceeds 500 MB'
    )
  } finally {
    fs.statSync = origStat
  }
})

// ── #7c: valid path inside uploads/ is accepted ───────────────────────────────
test('#7c — valid file inside uploads dir is accepted (returns resolved path)', () => {
  const resolved = validateVideoPath(validFile, tmpUploads)
  assert.strictEqual(resolved, path.resolve(validFile), 'must return the resolved absolute path')
})

test('#7c — validateVideoPath works without allowedDir (no boundary check)', () => {
  const resolved = validateVideoPath(validFile)
  assert.strictEqual(resolved, path.resolve(validFile))
})

// ── Cleanup ───────────────────────────────────────────────────────────────────
fs.rmSync(tmpUploads, { recursive: true, force: true })

console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
