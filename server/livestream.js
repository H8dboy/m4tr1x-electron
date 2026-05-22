/**
 * M4TR1X — Live Streaming (WebRTC + Nostr signaling)
 *
 * Architecture:
 *  - Streamer publishes a Nostr kind-1 event tagged [t, m4tr1x-live] with stream metadata
 *  - Viewers discover streams by subscribing to [t, m4tr1x-live] events
 *  - WebRTC signaling (offer/answer/ICE) is exchanged via encrypted Nostr DMs
 *  - Media flows P2P via WebRTC — no central media server needed
 *  - The Express HTTP server handles /api/v1/stream/* for the Electron frontend
 *    (the actual WebRTC negotiation happens in the browser via the frontend JS)
 */

const fs   = require('fs')
const path = require('path')
const { publishNote, sendEncryptedDM, getCurrentPubkey, loadSavedKeys, subscribeToFilter } = require('./nostr')

const LIVE_TAG  = 'm4tr1x-live'
const LIVE_KIND = 1

const DATA_DIR      = process.env.M4TR1X_DATA_DIR || process.cwd()
const STREAMS_FILE  = path.join(DATA_DIR, 'active_streams.json')

// Active streams known to this node — persisted across restarts
const activeStreams = new Map()

// ─── Persistence ─────────────────────────────────────────────────────────────

function saveStreams() {
  try {
    const arr = [...activeStreams.values()]
    fs.writeFileSync(STREAMS_FILE, JSON.stringify(arr, null, 2))
  } catch {}
}

function loadStreams() {
  try {
    const arr = JSON.parse(fs.readFileSync(STREAMS_FILE, 'utf8'))
    const now = Math.floor(Date.now() / 1000)
    for (const s of arr) {
      // Scarta stream più vecchi di 12 ore (probabilmente morti)
      if (now - s.startedAt < 12 * 3600) {
        activeStreams.set(s.streamId, s)
      }
    }
    if (activeStreams.size) console.log(`[LIVE] Restored ${activeStreams.size} stream(s) from disk.`)
  } catch {}
}

// Carica all'avvio
loadStreams()

// ─── Start a live stream (streamer side) ─────────────────────────────────────

async function startStream({ title, category = 'reels', pubkey }) {
  const streamId  = `${pubkey}-${Date.now()}`
  const startedAt = Math.floor(Date.now() / 1000)
  const nodeUrl   = process.env.PUBLIC_NODE_URL || null

  const content = JSON.stringify({
    type: LIVE_TAG, streamId,
    title: title || 'Live Stream',
    category, startedAt, nodeUrl,
  })

  const keys = loadSavedKeys()
  if (keys) {
    await publishNote(content, keys.privkey, [
      ['t', LIVE_TAG],
      ['t', `m4tr1x-live-${category}`],
      ['stream-id', streamId],
      ['title', title || 'Live Stream'],
      ['category', category],
    ])
  }

  const stream = { streamId, title, category, pubkey, startedAt, viewerCount: 0, local: true }
  activeStreams.set(streamId, stream)
  saveStreams()
  console.log(`[LIVE] Stream started: ${streamId}`)
  return stream
}

// ─── Stop a live stream ───────────────────────────────────────────────────────

async function stopStream(streamId) {
  const stream = activeStreams.get(streamId)
  if (!stream) return false

  const keys = loadSavedKeys()
  if (keys) {
    await publishNote(
      JSON.stringify({ type: 'm4tr1x-live-end', streamId }),
      keys.privkey,
      [['t', 'm4tr1x-live-end'], ['stream-id', streamId]]
    ).catch(() => {})
  }

  activeStreams.delete(streamId)
  saveStreams()
  console.log(`[LIVE] Stream stopped: ${streamId}`)
  return true
}

// ─── WebRTC signaling via encrypted DM ───────────────────────────────────────
// signal: { type: 'offer'|'answer'|'ice', sdp?, candidate? }

async function sendSignal(toPubkey, signal) {
  const keys = loadSavedKeys()
  if (!keys) throw new Error('No Nostr identity to sign signal')
  const payload = JSON.stringify({ m4tr1x_webrtc: true, ...signal })
  await sendEncryptedDM(toPubkey, payload, keys.privkey)
}

// ─── Viewer tracking ──────────────────────────────────────────────────────────

function joinStream(streamId, viewerPubkey) {
  const s = activeStreams.get(streamId)
  if (!s) return false
  if (!s.viewers) s.viewers = new Set()
  s.viewers.add(viewerPubkey)
  s.viewerCount = s.viewers.size
  return true
}

function leaveStream(streamId, viewerPubkey) {
  const s = activeStreams.get(streamId)
  if (!s || !s.viewers) return false
  s.viewers.delete(viewerPubkey)
  s.viewerCount = s.viewers.size
  return true
}

// ─── Register a stream discovered from Nostr ─────────────────────────────────

function registerRemoteStream(ev) {
  try {
    const data = JSON.parse(ev.content)
    if (data.type !== LIVE_TAG) return
    activeStreams.set(data.streamId, {
      streamId:    data.streamId,
      title:       data.title,
      category:    data.category,
      pubkey:      ev.pubkey,
      startedAt:   data.startedAt,
      viewerCount: 0,
      local:       false,
      nodeUrl:     data.nodeUrl || null,
    })
    saveStreams()
  } catch {}
}

function removeRemoteStream(ev) {
  try {
    const data = JSON.parse(ev.content)
    if (data.type === 'm4tr1x-live-end') {
      activeStreams.delete(data.streamId)
      saveStreams()
    }
  } catch {}
}

// ─── Subscribe to live stream announcements ───────────────────────────────────

function startLiveDiscovery() {
  const since = Math.floor(Date.now() / 1000) - 3600  // last 1h
  subscribeToFilter({ kinds: [1], '#t': [LIVE_TAG], since }, ev => {
    try {
      const data = JSON.parse(ev.content)
      if (data.type === LIVE_TAG)         registerRemoteStream(ev)
      if (data.type === 'm4tr1x-live-end') removeRemoteStream(ev)
    } catch {}
  })
  console.log('[LIVE] Live stream discovery started.')
}

// ─── List active streams ──────────────────────────────────────────────────────

function listStreams(category) {
  const streams = [...activeStreams.values()].map(s => ({
    ...s,
    viewers: undefined,  // non serializzare il Set
  }))
  return category ? streams.filter(s => s.category === category) : streams
}

module.exports = {
  startStream,
  stopStream,
  sendSignal,
  joinStream,
  leaveStream,
  registerRemoteStream,
  removeRemoteStream,
  startLiveDiscovery,
  listStreams,
  LIVE_TAG,
}
