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

### Frontend — CSP: handler inline → delega (B2)
- La CSP dell'app (`script-src 'self' 'nonce-…'`, senza `unsafe-inline`) blocca gli
  handler inline `onclick`/`oninput`/`onchange`: nel build Electron l'intera UI
  sarebbe non funzionante (topbar, modali, tab). Verificato empiricamente in Chromium.
- Aggiunto un dispatcher di delega unico (un solo listener su `document`) che rimpiazza
  gli handler inline con `data-action` / `data-close` / `data-oninput` / `data-onchange`,
  con override `ACTIONS`/`INPUTS` per i casi con elemento/evento. Funziona anche sui nodi
  generati a runtime.
- Migrati **tutti** gli handler inline (0 rimasti): 133 statici (topbar, section-tabs,
  bottom-nav, modali, backdrop, setSats/setBoost/selToken/selCat, input file) + i ~25
  dentro i template JS generati a runtime (feed slide, forum, music, shop, story, proto).
- Aggiunto `escAttr()` (escapa anche `"` e `'`, che `esc()` NON escapava) per i valori
  passati via `data-args`: chiude un buco latente di attribute-injection nei template.
  Verificato con round-trip su input ostile (`"`/`'`/`<img onerror>`/`&`): valore integro
  alla funzione, zero nodi iniettati, zero attribute-breakout.
- Verificato empiricamente in Chromium headless: dispatcher reale sotto CSP reale —
  no-arg, `data-args`, override `ACTIONS` con elemento/evento, backdrop, e round-trip
  escaping. Tutti i 5 blocchi `<script>` passano il syntax-check.

### Fix — quick win (D)
- **D1** `universalPost`: `publishNote(body, nostrTags)` passava gli hashtag dove va la
  privkey (`publishNote(content, privkeyHex, tags)`) → il post universale su Nostr perdeva
  i tag/falliva. Corretto in `publishNote(body, null, nostrTags)`.
- **D2** `/api/v1/admin/reload` era senza protezione (chiunque poteva forzare un reload del
  server). Ora dietro `localhostOnly` + `verifyAdminKey`.
- **D3** Mint: senza `H8_ADMIN_MINT_KEY` il mint era sempre disabilitato anche con una
  `ADMIN_KEY` valida. Ora l'autorità è `H8_ADMIN_MINT_KEY` se impostata, altrimenti la
  `ADMIN_KEY` del server (esposta a `process.env` per coerenza). Resta sempre dietro chiave
  admin (P8) — mai aperto. Nuovo test `tests/test-d-fixes.js` (D2 + D3).
- **D4** `changePassword`: il file `.bak` (envelope cifrato con la VECCHIA password) restava
  su disco dopo un cambio riuscito. Ora viene rimosso al completamento; il backup copre solo
  la finestra di crash tra write e rename. Test `test-h8identity-changepw.js` aggiornato.

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
