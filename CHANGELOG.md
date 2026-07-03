# Changelog

## Unreleased

### Security — hardening rete API (allineamento a m4tr1x-node)
- CORS: rimosso `origin: true`. L'API `:8080` ora accetta solo localhost, LAN privata
  (192.168./10./172.), `.onion` e le origini in `ALLOWED_ORIGINS`. Un sito esterno aperto
  nel browser dell'utente non può più chiamare il nodo.
- Aggiunti 5 security headers su ogni risposta: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` (geolocation/microphone/camera negati).
- Bind API da `0.0.0.0` a `127.0.0.1` di default: l'Electron è il dispositivo dell'utente,
  non un server di rete. Diventa raggiungibile dalla LAN solo con `PUBLIC_NODE_URL` (nodo
  pubblico opt-in) o `M4TR1X_BIND_HOST`. Il relay Nostr `:4848` resta invariato per la mesh.
- Nuovo test `tests/test-cors-bind.js` (10 asserzioni).

## v2.3.0 — Developer Preview

### H8 Token Economy (live)
- Modulo `server/h8token.js`: ledger hash chain SHA3-256, firme ML-DSA65
- 9 endpoint: balance, history, transfer, tip (split 50/20/30), boost, boost/batch, boost/:id, chain/verify, admin/mint
- Supporto pseudo-address `nostr_<pubkey[:38]>` come destinatario tip

### Security
- Scrypt N=131072 per H8 identity (migration silenziosa v1→v2)
- Rimosso modulo Monero dead code (TLS bypass)
- Git history pulita

### Truth alignment
- Banner DM: Nostr NIP-44 (era erroneamente "Signal Protocol")
- README e GitHub About allineati alla realtà
- Shop documentato come Nostr-native (kind:30402)

### Compat
- Alias frontend: `/api/v1/timelines/tag/:tag`, `/videos`, `/tracks`
- Config fallback a localhost quando privateNodeUrl null
- `server/index.js` legge `PORT` dall'env quando avviato direttamente

### Known limitations (v2.4)
- Pseudo-address `nostr_...` riceve tip ma non spende (claim flow in v2.3.1)
- Mint manuale via admin (fiat gateway in v2.4)
- Mobile Tauri presente ma non distribuito (v2.4)
- No moderation reporting (v2.4)
