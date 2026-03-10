# M4TR1X v2.0 — Electron

> **Decentralized social network for authentic video documentation.**
> Zero Python. Zero server. L'utente scarica l'app e tutto gira in locale.

---

## Cosa cambia rispetto a v1

| v1 (Python)         | v2 (Electron + Node.js)         |
|---------------------|---------------------------------|
| Python + FastAPI    | Node.js + Express               |
| PyTorch             | ONNX Runtime (Node.js)          |
| cryptography.Fernet | Node.js crypto (AES-256-GCM)    |
| Script separati     | App desktop unica               |
| Richiede setup      | Scarica e apri                  |

---

## Prerequisiti (per sviluppo)

- **Node.js** 18+ → https://nodejs.org
- **ffmpeg** (opzionale — incluso automaticamente via `ffmpeg-static` dopo `npm install`)
- **ExifTool** (opzionale, per pulizia metadati GPS/EXIF) → https://exiftool.org

---

## Installazione e avvio

```bash
# 1. Installa dipendenze (include ffmpeg-static e ffprobe-static automaticamente)
npm install

# 2. (Opzionale) Configura variabili d'ambiente
cp .env.example .env

# 3. Avvia in modalità sviluppo
npm start
```

L'app si apre come finestra desktop. Il server API locale gira su `http://localhost:8080`.

---

## Modello AI (ONNX)

La funzione core dell'app richiede il modello ONNX (EfficientNet-B0 per rilevare video AI-generated).

**Se hai il vecchio progetto Python:**
```bash
cd m4tr1x-python
python ai_detector.py --export-onnx
cp models/m4tr1x_detector.onnx ../m4tr1x-electron/models/
```

> **Senza il modello `.onnx`**, la detection gira in modalità **UNCERTAIN** — nessun crash, ma nessuna analisi reale.

---

## Build distribuzione

```bash
npm run build:win    # Windows (.exe NSIS installer)
npm run build:mac    # macOS (.dmg — icon.png viene convertita in .icns automaticamente)
npm run build:linux  # Linux (.AppImage)
```

I file di distribuzione vengono creati in `dist/`.

---

## Struttura progetto

```
m4tr1x-electron/
├── main.js              # Electron entry point + sicurezza CSP/Tor
├── preload.js           # Bridge sicuro renderer ↔ main (contextBridge)
├── package.json
├── .env.example
├── assets/
│   ├── icon.png         # Icona app (Linux + macOS source)
│   └── icon.ico         # Icona app (Windows)
├── server/
│   ├── index.js         # Express API server + tutte le route
│   ├── ai_detector.js   # ONNX AI detector (usa ffmpeg-static se disponibile)
│   ├── core.js          # Pulizia metadati ExifTool
│   ├── uploader.js      # Cifratura video AES-256-GCM
│   ├── db.js            # SQLite (risultati analisi)
│   ├── shop.js          # Shop decentralizzato XMR
│   ├── monero.js        # Wallet Monero integrato
│   ├── nostr.js         # Protocollo Nostr (NIP-01, NIP-44, NIP-19)
│   ├── mastodon.js      # Integrazione Mastodon / ActivityPub
│   ├── peertube.js      # Integrazione PeerTube
│   ├── funkwhale.js     # Integrazione Funkwhale (musica)
│   └── tor.js           # Rilevamento e configurazione Tor automatica
├── frontend/
│   ├── index.html       # App principale (feed, forum, shop, DM)
│   ├── auth.html        # Autenticazione Nostr
│   └── safety.html      # Guida sicurezza (6 lingue)
└── models/
    └── m4tr1x_detector.onnx   ← metti qui il modello
```

---

## API completa

Il server gira su `http://localhost:8080`. Le route `/api/v1/*` accettano opzionalmente `X-API-Key` (configurabile in `.env`).

### Core

| Method | Endpoint | Descrizione |
|--------|----------|-------------|
| GET  | `/health`               | Health check — stato server, ExifTool |
| POST | `/api/v1/analyze`       | Upload + analisi video (multipart `video`) |
| GET  | `/api/v1/analysis/:id`  | Risultato analisi per ID |
| GET  | `/api/v1/analyses`      | Lista risultati (`?limit=N`) |

### Nostr

| Method | Endpoint | Descrizione |
|--------|----------|-------------|
| POST | `/api/v1/nostr/keys`        | Genera nuovo keypair |
| POST | `/api/v1/nostr/load-keys`   | Carica chiavi (`{ privkey }`) |
| GET  | `/api/v1/nostr/relays`      | Connetti e lista relay attivi |
| GET  | `/api/v1/nostr/feed`        | Feed (`?tags=...&limit=N`) |
| POST | `/api/v1/nostr/post`        | Pubblica nota (`{ content, tags }`) |
| POST | `/api/v1/nostr/profile`     | Pubblica profilo (kind:0) |
| POST | `/api/v1/nostr/dm`          | Invia DM cifrato NIP-44 (`{ recipientPubkey, message }`) |
| GET  | `/api/v1/nostr/dm/:pubkey`  | Fetch DM con una pubkey |

### Mastodon

| Method | Endpoint | Descrizione |
|--------|----------|-------------|
| GET  | `/api/v1/mastodon/timeline`     | Timeline pubblica (`?instance=...&limit=N`) |
| GET  | `/api/v1/mastodon/hashtag/:tag` | Cerca hashtag (`?instances=a,b&limit=N`) |
| GET  | `/api/v1/mastodon/search`       | Ricerca testo (`?q=...&instance=...`) |
| POST | `/api/v1/mastodon/post`         | Pubblica post (`{ instance, accessToken, content }`) |

### PeerTube

| Method | Endpoint | Descrizione |
|--------|----------|-------------|
| GET  | `/api/v1/peertube/videos`                | Video recenti (`?instance=...&limit=N`) |
| GET  | `/api/v1/peertube/search`                | Cerca video (`?q=...&instances=a,b`) |
| GET  | `/api/v1/peertube/video/:instance/:uuid` | Dettaglio video |
| GET  | `/api/v1/peertube/instances`             | Scopri istanze |

### Funkwhale (Musica)

| Method | Endpoint | Descrizione |
|--------|----------|-------------|
| GET  | `/api/v1/music/tracks`    | Tracce recenti (`?instance=...&limit=N`) |
| GET  | `/api/v1/music/search`    | Cerca tracce (`?q=...&instances=a,b`) |
| GET  | `/api/v1/music/albums`    | Album recenti |
| GET  | `/api/v1/music/channels`  | Canali / artisti |
| GET  | `/api/v1/music/instances` | Scopri istanze |

### Monero Wallet

| Method | Endpoint | Descrizione |
|--------|----------|-------------|
| GET  | `/api/v1/wallet/status`   | Stato wallet (esiste? saldo?) |
| POST | `/api/v1/wallet/create`   | Crea wallet (`{ password }`) — seed mostrato UNA SOLA VOLTA |
| POST | `/api/v1/wallet/restore`  | Ripristina da seed (`{ seed, password, restoreHeight }`) |
| POST | `/api/v1/wallet/open`     | Apri wallet (`{ password }`) |
| POST | `/api/v1/wallet/sync`     | Sincronizza con blockchain |

### Shop Decentralizzato

| Method | Endpoint | Descrizione |
|--------|----------|-------------|
| GET    | `/api/v1/shop/listings`          | Lista prodotti (`?category=...&limit=N`) |
| GET    | `/api/v1/shop/listings/:id`      | Dettaglio prodotto |
| POST   | `/api/v1/shop/listings`          | Crea prodotto (`{ sellerPubkey, title, priceXMR, ... }`) |
| DELETE | `/api/v1/shop/listings/:id`      | Disattiva prodotto (`{ sellerPubkey }`) |
| POST   | `/api/v1/shop/orders`            | Avvia acquisto → genera indirizzo XMR (`{ listingId, buyerPubkey }`) |
| GET    | `/api/v1/shop/orders/:id`        | Dettaglio ordine |
| GET    | `/api/v1/shop/orders/:id/verify` | Verifica pagamento sulla blockchain |

---

## Note di sicurezza

- **Chiave privata Nostr**: tenuta in `sessionStorage` (si cancella alla chiusura dell'app). Non viene mai inviata al server. Roadmap: migrazione a `Electron.safeStorage` per cifratura OS-level.
- **Wallet Monero**: le chiavi restano sul dispositivo, cifrate con la password scelta dall'utente. Il seed viene mostrato **una sola volta** alla creazione.
- **Tor**: se Tor Browser o il daemon `tor` sono attivi al lancio, tutto il traffico dell'app passa automaticamente via Tor (SOCKS5 proxy).
- **Metadati video**: se ExifTool è installato, i metadati GPS/EXIF vengono rimossi prima dell'analisi.

---

> *"In the age of synthetic reality, authenticity is the new resistance."*
> **For the Truth. 👁️**
