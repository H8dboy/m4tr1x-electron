# M4TR1X — Team Opportunity

**A technical overview for senior engineers considering joining the project**

---

## Executive Summary

M4TR1X is a production-grade decentralized social network built to resist regulatory capture and surveillance. The architecture is mature, the codebase is professional, and the project is at an inflection point where specialized engineering talent can have immediate, measurable impact.

This document outlines what M4TR1X is, the seriousness of its implementation, the current state of the codebase, and where we are on the roadmap.

---

## 1. What M4TR1X Is

### 1.1 The Problem We Solve

Between 2024–2025, the EU moved toward mandatory identity verification for social media access through the Digital Services Act (DSA), age verification proposals, and digital identity schemes. These regulations assume that social infrastructure is centralized — that you send a compliance letter to a company, and they enforce it.

M4TR1X rejects this assumption entirely. There is no company. There is no central server. There is no user database. Your identity is a cryptographic key pair that lives on your device, encrypted with a password only you know.

Regulators cannot send a compliance notice to no one. Platforms cannot violate user privacy if they have no user data. Users cannot be forced to verify their age if there is nothing to verify against.

### 1.2 The Architecture

M4TR1X is a **federated social network** where users own their identity and content lives on community-run nodes:

- **Desktop (Electron)** — the reference client, runs the embedded API server and Nostr relay in-process
- **Mobile (Android/iOS via Capacitor)** — connects to M4TR1X nodes over WebSocket
- **Self-hosted nodes** — any user can run their own backend to store and serve content
- **Decentralized identity** — cryptographic keypairs, no email/phone registration
- **Economic layer** — H8 token (closed utility token, Twitch-Bits model) for tipping creators and incentivizing node operators

### 1.3 Feature Set (v2.3.0)

Users can:
- Post text, images, and video
- Watch videos served from M4TR1X nodes
- Share music and long-form content
- Send end-to-end encrypted messages
- Tip creators using H8 tokens
- Participate in distributed labeling of AI-generated video
- Run their own node and earn 30% of tips automatically

---

## 2. Code Quality & Architecture

### 2.1 Technology Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| **Desktop App** | Electron 32 + Express.js | Isolation between crypto + UI; in-process API avoids separate server process |
| **Backend Relay** | Node.js 18+, better-sqlite3 | Nostr NIP-01/11 relay; deterministic write-only ledger |
| **Cryptography** | @noble/post-quantum (ML-DSA65) | Post-quantum signature scheme (NIST FIPS-204, 2024); all transactions signed |
| **Ledger** | SQLite + SHA3-256 hash chain | Immutable transaction log; write-once semantics, no UPDATE/DELETE |
| **Storage** | Blossom blob store (SHA-256 addressed) | Content-addressed storage; replicated across nodes; federated |
| **Video** | ffmpeg + HLS transcoding | Segmented streaming; on-node codec support for mobile |
| **AI Detection** | ONNX Runtime + EfficientNet-B0 | Community-trained deepfake detector; updates via Nostr/IPFS |
| **Network** | Tor SOCKS5 (auto-detection) | Transparent routing on censored networks; built-in bridges (obfs4, Snowflake, meek-azure) |

### 2.2 Architectural Maturity

The codebase demonstrates professional engineering practices:

#### **Security Model**
- Every account uses **ML-DSA-65 keypairs** (NIST post-quantum standard)
- Private keys encrypted at rest: **AES-256-GCM** with **scrypt N=131072** (memory-hard derivation)
- All transactions signed; ledger verifiable end-to-end
- No account recovery — security by design, not convenience
- Electron CSP headers, renderer sandboxing, context isolation

#### **Concurrency & Atomicity**
- Per-sender locking in `h8token.js` prevents race conditions across async signing
- SQLite transactions span database operations only (not async crypto)
- Write-ahead logging (WAL mode) for concurrent reads during writes
- Balance checks and signature verification serialized per-sender

#### **Database Design**
- **h8ledger.db**: immutable transaction log (write-only-append)
- **m4tr1x.db**: universal post protocol accounts, badges, analysis results
- **crowdtrain.db**: votes, reputation, model metadata
- All three databases automatically versioned; migration strategy documented
- Schema includes audit trail of previous migrations

#### **Error Recovery**
- Atomic file operations: backup → tmp → rename pattern
- Recovery mechanisms for password changes (includes .bak file preservation)
- Graceful degradation: missing ONNX models fall back to "UNCERTAIN" verdict
- Network failures don't crash the app (Nostr sync is background-only)

#### **Code Organization**
- Clear separation of concerns: `h8identity.js` (auth), `h8token.js` (economy), `nostr.js` (federation), `relay.js` (event store)
- No circular dependencies; lazy-load pattern for optional modules
- Well-commented, especially crypto and audit-critical code
- Architecture docs (`docs/ARCHITECTURE.md`) walks new contributors through reading order

### 2.3 Test Coverage & Deployment

| Area | Status | Notes |
|------|--------|-------|
| Smoke tests | ✅ Implemented | `scripts/smoke-test.js` covers startup + basic API calls |
| Unit tests | ⏳ Partial | Core crypto (`h8identity.js`), ledger chain verification |
| Integration tests | ⏳ In progress | Nostr relay, federation modules, node discovery |
| Security audit | ✅ External (Audit #4 completed) | Signature verification, schema migrations, concurrency patterns |
| CI/CD | ✅ GitHub Actions | Matrix builds for Linux/macOS/Windows on every tag |
| Reproducible builds | ✅ SHA-256 checksums published | Builds fully reproducible from source |

### 2.4 Known Limitations & Technical Debt

**Intentional design choices** (not bugs):
- No auto-update mechanism (manual downloads + hash verification)
- No traditional "password recovery" (keys are final)
- No moderation reporting (v2.4+ feature)
- No fiat gateway (planned)

**Areas for engineering focus**:
1. **Test suite expansion** — automated integration tests for relay + federation layer
2. **Performance optimization** — video transcoding queue, batch Nostr event processing
3. **Mobile polish** — Capacitor bridge for Tor routing, native crypto acceleration
4. **Monitoring & logging** — structured logs, metrics export, node health checks

---

## 3. Project Status & Roadmap

### 3.1 Current Release: v2.3.0 (Developer Preview)

**Live capabilities:**
- Desktop app: posts, videos, music, messaging, tipping
- Mobile app: video feed, photos, stories (Capacitor build)
- AI detector: community voting → model retraining → auto-distribution
- Node operator economics: automatic tip splitting (30% to node, 50% to creator, 20% platform)
- Embedded Nostr relay: full NIP-01/11 compliance

**First public node:** Live and accepting connections

### 3.2 Roadmap (v2.3.1 → v3.0)

| Version | Timeline | Focus |
|---------|----------|-------|
| **v2.3.1** | June 2026 | Upload access restricted to verified accounts; spam mitigation |
| **v2.4** | Q3 2026 | **Public Beta** — onboarding wizard, DSA compliance reporting, mobile builds (Play Store + TestFlight) |
| **v3.0** | Q4 2026 | Independent security audit, multi-language UI, full-disk encryption integration |

### 3.3 Scaling Challenges (Planned Engineering Work)

1. **Ledger performance** — current SQLite ledger works for thousands of tx/day; need to evaluate sharding/rollup strategy for millions
2. **Content distribution** — Blossom blob store bandwidth and replication; planning IPFS/Torrent integration
3. **Nostr relay scalability** — currently single-node; planning for multi-region federation
4. **AI model training** — crowdtrain pipeline runs offline; need streaming inference + model versioning strategy

---

## 4. Code Examples: Why It's Serious

### 4.1 Cryptographic Identity (`h8identity.js`)

```javascript
/**
 * ML-DSA-65 keypair generation + AES-256-GCM encryption
 * scrypt N=131072 (NIST SP 800-132 compliant)
 */
async function generateIdentity(password) {
  const { ml_dsa65 } = await getLib()
  const { secretKey, publicKey } = ml_dsa65.keygen()
  const stored = {
    version: 2,
    algorithm: 'ML-DSA65',
    address: h8AddressFrom(publicKey),
    publicKey: Buffer.from(publicKey).toString('hex'),
    ...encryptSecret(Buffer.from(secretKey).toString('hex'), password),
  }
  fs.writeFileSync(getIdentityPath(), JSON.stringify(stored))
  return { address, publicKey }
}
```

**What this shows:**
- NIST-standard post-quantum cryptography
- Key derivation using memory-hard scrypt (resistant to brute-force)
- Proper secret storage (never exposed in memory after initial setup)
- Semantic versioning for migration strategy

### 4.2 Immutable Ledger (`h8token.js`)

```javascript
function hashBlock(idx, ts, from, to, amount, type, contentId, prevHash) {
  const input = `${idx}|${ts}|${from}|${to}|${amount}|${type}|${contentId||''}|${prevHash}`
  return bytesToHex(sha3_256(new TextEncoder().encode(input)))
}

async function appendBlock({ from, to, amount, tx_type, content_id = null, note = null }) {
  // Serialize per-sender to prevent race conditions
  return withSenderLock(from, async () => {
    if (getBalance(from) < amount) throw new Error('Saldo insufficiente')
    const idx = getLastBlock().block_index + 1
    const prevHash = getLastBlock().hash
    const hash = hashBlock(idx, ts, from, to, amount, tx_type, content_id, prevHash)
    const signature = await h8id.signWithUnlocked(hash)
    db.prepare('INSERT INTO ledger (...) VALUES (?, ...)').run(...)
    return block
  })
}
```

**What this shows:**
- Deterministic hashing for auditability
- Per-sender locking for atomic transaction processing
- ML-DSA signature on every transaction
- Balance verification before commit

### 4.3 Post-Quantum Chain Verification

```javascript
async function verifyChain() {
  const rows = db.prepare('SELECT * FROM ledger ORDER BY block_index ASC').all()
  for (const b of rows) {
    // Check hash chain integrity
    const recomputed = hashBlock(b.block_index, b.ts, b.from_addr, b.to_addr, b.amount, b.tx_type, b.content_id, b.prev_hash)
    if (recomputed !== b.hash) return { valid: false, reason: 'hash mismatch' }
    
    // Verify ML-DSA signature on every block (except genesis)
    if (b.tx_type !== 'mint' || b.from_addr !== '0x0') {
      const sigOk = await h8id.verifySignature(b.from_pubkey, b.hash, b.signature)
      if (!sigOk) return { valid: false, reason: 'invalid ML-DSA signature' }
    }
  }
  return { valid: true, blocks: rows.length }
}
```

**What this shows:**
- Complete chain validation (no shortcuts)
- Signature verification on every transaction
- Audit trail preserved in database (from_pubkey column added in migration #3)

---

## 5. Team & Collaboration

### 5.1 Current Structure

- **Founder/Lead**: H8db0y — architecture, security, crypto, core systems
- **Repos**: 6 public repositories + private head node
  - `m4tr1x-electron` — desktop app + API server (1,325 commits)
  - `m4tr1x-node` — self-hosted backend (5,325 commits)
  - `m4tr1x-android` — mobile app (Capacitor)
  - `m4tr1x-ai-detector` — community-trained deepfake model
  - ...plus experimental modules

### 5.2 How You Can Contribute

**If you're a backend engineer:**
- Ledger scaling (sharding, rollup strategy)
- Nostr relay performance (multi-region federation)
- Node discovery and health monitoring
- Testing infrastructure (integration tests, chaos engineering)

**If you're a frontend engineer:**
- Mobile app polish (Tor routing, native UI components)
- Desktop app UX (onboarding wizard, settings refinement)
- Accessibility improvements
- Multi-language support (v3.0)

**If you're an ML/AI engineer:**
- Improve AI detection model (active learning, curriculum learning)
- Streaming training pipeline
- Model compression for on-device inference

**If you're a DevOps/Security engineer:**
- Reproducible build infrastructure
- Security audit preparation (v3.0)
- Monitoring + alerting for public nodes
- Regulatory compliance documentation (DSA reporting)

### 5.3 Collaboration Model

- All work via GitHub issues and pull requests (public review)
- Security issues: contact SECURITY.md
- Code review standards: at least one approval before merge
- Commit messages follow conventional commits (`feat:`, `fix:`, `docs:`, etc.)
- No corporate governance — decisions made by merit and discussion

---

## 6. Why This Matters

### 6.1 Technical Achievement

M4TR1X demonstrates that **decentralized social infrastructure is achievable today**, not a theoretical exercise. The codebase is:
- **Production-ready** for developer preview
- **Cryptographically sound** (NIST post-quantum standards)
- **Architecturally mature** (proper error handling, database design, network resilience)
- **Actively developed** (recent commits, roadmap clarity)

### 6.2 Impact

If you're interested in building systems that:
- **Resist censorship** by design (no single point of failure)
- **Respect privacy** (no surveillance, no data broker, no algorithm)
- **Put users in control** (cryptographic identity, user-owned nodes)
- **Scale globally** while remaining decentralized

...this is the project.

### 6.3 Your Role

We're looking for engineers who can:
- Write code that lasts (clean, documented, testable)
- Understand cryptography enough to not break it
- Think about distributed systems (consensus, replication, failure modes)
- Ship code (not just plan projects)
- Tolerate ambiguity (this is a young project; roadmap evolves)

---

## 7. Logistics

**Repository links:**
- Desktop: https://github.com/H8db0y/m4tr1x-electron
- Node: https://github.com/H8db0y/m4tr1x-node
- Mobile: https://github.com/H8db0y/m4tr1x-android
- AI Detector: https://github.com/H8db0y/m4tr1x-ai-detector

**Getting started:**
```bash
git clone https://github.com/H8db0y/m4tr1x-electron.git
cd m4tr1x-electron
npm install && cd server && npm install && cd ..
npm start
# Desktop app runs at http://localhost:8080/app
```

**Recommended reading order** (before first contribution):
1. `docs/ARCHITECTURE.md` — 10-minute system overview
2. `server/index.js` (top 100 lines) — API surface
3. `server/h8identity.js` — identity + crypto model
4. `server/h8token.js` — ledger design + economy
5. `server/nostr.js` — federation protocol

**Questions?**
- Open an issue on GitHub
- Email: h8db0y@protonmail.com
- Read CONTRIBUTING.md for dev setup details

---

## 8. Conclusion

M4TR1X is at the stage where it needs specialized engineering talent to move from **developer preview** to **public beta** and eventually **production**. The foundation is solid. The vision is clear. The roadmap is realistic.

If you're an engineer who wants to build infrastructure that genuinely protects user freedom — and you enjoy the craft of building that infrastructure seriously, with clean code and rigorous thinking — let's talk.

**Welcome to the team.** 🚀

---

*Last updated: May 26, 2026*
*Version: 1.0*
