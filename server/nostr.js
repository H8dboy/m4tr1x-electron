/**
 * M4TR1X - Nostr Protocol Integration
 *
 * Il cuore dell'app. Nostr è un protocollo aperto e decentralizzato:
 * nessun server centrale, nessun account da registrare, nessuno può
 * bannare o silenziare nessuno. Ogni messaggio è firmato con la
 * chiave privata dell'utente — prova crittografica che è autentico.
 *
 * NIPs implementati:
 *  NIP-01 — Protocollo base (eventi, sottoscrizioni, relay)
 *  NIP-44 — DM cifrati (ChaCha20-Poly1305 + ECDH secp256k1)
 *  NIP-19 — Encoding bech32 (npub, nsec)
 *
 * FIX applicati rispetto alla prima versione:
 *  - nip44 e nip19 importati come submodule separati (nostr-tools v2)
 *  - Rimosso memory leak: listener WebSocket ora vengono rimossi dopo l'uso
 *  - Rimossa variabile 'originalOnMessage' inutilizzata
 *  - Gestione robusta delle connessioni con cleanup automatico
 */

const {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  verifyEvent,
} = require('nostr-tools')

// In nostr-tools v2, nip44 e nip19 sono submodule separati
const nip44 = require('nostr-tools/nip44')
const nip19 = require('nostr-tools/nip19')

const WebSocket = require('ws')

// ─── Relay pubblici ───────────────────────────────────────────────────────────
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
  'wss://nostr.wine',
  'wss://relay.nostr.bg',
  'wss://nostr.mom',
]

// ─── Stato interno ────────────────────────────────────────────────────────────
let userPrivKey = null
let userPubKey  = null
let connections = {}   // url → WebSocket

// ─── Gestione chiavi ─────────────────────────────────────────────────────────

function generateKeys() {
  const privkey = generateSecretKey()
  const pubkey  = getPublicKey(privkey)
  return {
    privkey: Buffer.from(privkey).toString('hex'),
    pubkey,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(privkey),
  }
}

function loadKeys(privkeyHex) {
  userPrivKey = Uint8Array.from(Buffer.from(privkeyHex, 'hex'))
  userPubKey  = getPublicKey(userPrivKey)
  console.log(`[NOSTR] Chiavi caricate: ${userPubKey.substring(0, 16)}...`)
}

function getCurrentPubkey() { return userPubKey }

// ─── Connessione relay ────────────────────────────────────────────────────────

async function connectToRelays(relays = DEFAULT_RELAYS) {
  const connected = []

  await Promise.allSettled(relays.map(url => new Promise((resolve) => {
    if (connections[url]?.readyState === WebSocket.OPEN) {
      connected.push(url); return resolve()
    }

    const ws      = new WebSocket(url)
    const timeout = setTimeout(() => { ws.terminate(); resolve() }, 5000)

    ws.on('open', () => {
      clearTimeout(timeout)
      connections[url] = ws
      connected.push(url)
      console.log(`[NOSTR] Connesso: ${url}`)
      resolve()
    })
    ws.on('error', () => { clearTimeout(timeout); resolve() })
    ws.on('close', () => { delete connections[url] })
  })))

  console.log(`[NOSTR] ${connected.length}/${relays.length} relay attivi`)
  return connected
}

function getConnectedRelays() {
  return Object.keys(connections).filter(
    url => connections[url]?.readyState === WebSocket.OPEN
  )
}

// ─── Pubblicazione eventi ─────────────────────────────────────────────────────

async function publishEvent(eventTemplate) {
  if (!userPrivKey) throw new Error('Keys not loaded. Call loadKeys() first.')

  const event = finalizeEvent({
    ...eventTemplate,
    pubkey:     userPubKey,
    created_at: Math.floor(Date.now() / 1000),
  }, userPrivKey)

  if (!getConnectedRelays().length) await connectToRelays()

  const message = JSON.stringify(['EVENT', event])
  for (const url of getConnectedRelays()) {
    try { connections[url].send(message) }
    catch (err) { console.warn(`[NOSTR] Errore invio a ${url}: ${err.message}`) }
  }

  console.log(`[NOSTR] Evento pubblicato (kind ${event.kind}): ${event.id.substring(0, 12)}...`)
  return event
}

async function publishNote(content, tags = []) {
  return publishEvent({ kind: 1, content, tags })
}

async function publishVideoAttestation(analysisResult, content = '') {
  return publishEvent({
    kind:    30078,
    content: content || `M4TR1X Attestation: ${analysisResult.verdict}`,
    tags: [
      ['d',          `m4tr1x-${analysisResult.id}`],
      ['verdict',    analysisResult.verdict],
      ['hash',       analysisResult.video_hash_sha256],
      ['confidence', JSON.stringify(analysisResult.confidence)],
      ['t',          'm4tr1x'],
      ['t',          'verification'],
      ['t',          analysisResult.verdict.toLowerCase()],
    ],
  })
}

async function publishProfile(profile) {
  return publishEvent({ kind: 0, content: JSON.stringify(profile), tags: [] })
}

// ─── Sottoscrizioni con cleanup corretto ──────────────────────────────────────
// FIX: ogni chiamata registra il listener e lo RIMUOVE al termine,
// eliminando il memory leak della versione precedente.

function subscribeOnce(relay, filter, onEvent, onEose, timeoutMs = 8000) {
  const subId   = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  let   settled = false

  function cleanup() {
    if (!settled) {
      settled = true
      relay.removeListener('message', onMessage)
      try { relay.send(JSON.stringify(['CLOSE', subId])) } catch (_) {}
    }
  }

  const timer = setTimeout(cleanup, timeoutMs)

  function onMessage(raw) {
    if (settled) return
    try {
      const msg = JSON.parse(raw.toString())
      if (msg[0] === 'EVENT' && msg[1] === subId) {
        onEvent(msg[2])
      } else if (msg[0] === 'EOSE' && msg[1] === subId) {
        clearTimeout(timer)
        cleanup()
        onEose()
      }
    } catch (_) {}
  }

  relay.on('message', onMessage)
  relay.send(JSON.stringify(['REQ', subId, filter]))

  return { close: cleanup }
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

async function fetchFeed({ authors, tags, limit = 50, since } = {}) {
  if (!getConnectedRelays().length) await connectToRelays()

  const filter = {
    kinds: [1],
    limit,
    since: since || Math.floor(Date.now() / 1000) - 86400,
  }
  if (authors?.length) filter.authors = authors
  if (tags?.length)    filter['#t']   = tags

  const relays = getConnectedRelays()
  if (!relays.length) return []

  const relay  = connections[relays[0]]
  const events = []

  return new Promise((resolve) => {
    subscribeOnce(
      relay,
      filter,
      (event) => { if (verifyEvent(event)) events.push(event) },
      ()      => resolve(events.sort((a, b) => b.created_at - a.created_at)),
      8000,
    )
  })
}

// ─── DM cifrati (NIP-44) ──────────────────────────────────────────────────────

async function sendEncryptedDM(recipientPubkey, message) {
  if (!userPrivKey) throw new Error('Keys not loaded')

  const conversationKey = nip44.getConversationKey(userPrivKey, recipientPubkey)
  const encrypted       = nip44.encrypt(message, conversationKey)

  return publishEvent({
    kind:    14,
    content: encrypted,
    tags:    [['p', recipientPubkey]],
  })
}

function decryptDM(senderPubkey, encryptedContent) {
  if (!userPrivKey) throw new Error('Keys not loaded')
  const conversationKey = nip44.getConversationKey(userPrivKey, senderPubkey)
  return nip44.decrypt(encryptedContent, conversationKey)
}

async function fetchDMs(otherPubkey) {
  if (!getConnectedRelays().length) await connectToRelays()

  const filter = {
    kinds:   [14],
    limit:   100,
    authors: [userPubKey, otherPubkey],
    '#p':    [userPubKey, otherPubkey],
  }

  const relays = getConnectedRelays()
  if (!relays.length) return []

  const relay  = connections[relays[0]]
  const events = []

  const raw = await new Promise((resolve) => {
    subscribeOnce(
      relay,
      filter,
      (event) => { if (verifyEvent(event)) events.push(event) },
      ()      => resolve(events),
      8000,
    )
  })

  return raw.map(event => {
    try {
      const plaintext = decryptDM(event.pubkey, event.content)
      return {
        id:         event.id,
        from:       event.pubkey,
        to:         event.tags.find(t => t[0] === 'p')?.[1],
        text:       plaintext,
        created_at: event.created_at,
        mine:       event.pubkey === userPubKey,
      }
    } catch { return null }
  }).filter(Boolean).sort((a, b) => a.created_at - b.created_at)
}

module.exports = {
  generateKeys,
  loadKeys,
  getCurrentPubkey,
  connectToRelays,
  getConnectedRelays,
  publishNote,
  publishVideoAttestation,
  publishEvent,
  publishProfile,
  fetchFeed,
  sendEncryptedDM,
  decryptDM,
  fetchDMs,
  DEFAULT_RELAYS,
}
