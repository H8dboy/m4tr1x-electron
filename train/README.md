# M4TR1X — Pipeline di Training

Il modello impara dagli utenti. Questo è il sistema che trasforma i voti
della community in un modello AI sempre più preciso.

---

## Come funziona

```
Utenti etichettano video (REALE / AI)
         ↓
Voti pubblicati su Nostr (firmati, decentralizzati)
         ↓
Consenso raggiunto (≥10 voti, ≥70% accordo)
         ↓
collect_labels.py → raccoglie le etichette
         ↓
train.py → addestra EfficientNet-B0
         ↓
publish_model.py → pubblica su IPFS + annuncia su Nostr
         ↓
L'app M4TR1X scarica il modello automaticamente
         ↓
Quando accuratezza ≥ 90%: il sistema è autonomo 🎉
```

---

## Prerequisiti

```bash
pip install -r requirements.txt

# ffmpeg (per estrarre frame dai video)
# Linux:
sudo apt install ffmpeg

# macOS:
brew install ffmpeg

# Windows:
# Scarica da https://ffmpeg.org/download.html
```

---

## Step 1 — Raccogli le etichette

```bash
# Sincronizza voti da Nostr + raccogli + estrai frame
python collect_labels.py \
    --output dataset/ \
    --sync-nostr \
    --extract-frames

# Solo nuove etichette (non ancora usate nel training)
python collect_labels.py --output dataset/ --only-new --extract-frames
```

Output: `dataset/labels.json`, `dataset/dataset_info.json`, `dataset/frames/`

---

## Step 2 — Addestra il modello

```bash
# Training base (20 epoche, GPU se disponibile)
python train.py --dataset dataset/ --output ../models/ --epochs 20

# Training intensivo (più accurato)
python train.py --dataset dataset/ --output ../models/ --epochs 50 --lr 5e-5

# Solo CPU (lento ma funziona)
python train.py --dataset dataset/ --output ../models/ --epochs 15
```

Output: `../models/m4tr1x_detector.onnx`, `../models/version.json`

---

## Step 3 — Pubblica il modello

### Opzione A — GitHub Releases (consigliato)
```bash
# 1. Vai su GitHub → Releases → New Release
# 2. Carica ../models/m4tr1x_detector.onnx
# 3. Copia l'URL del file, poi:

python publish_model.py \
    --onnx ../models/m4tr1x_detector.onnx \
    --version 2025.06.01 \
    --accuracy 0.923 \
    --samples 5000 \
    --url https://github.com/H8dboy/m4tr1x/releases/download/v2025.06/m4tr1x_detector.onnx \
    --privkey <la-tua-chiave-privata-hex>
```

### Opzione B — IPFS (decentralizzato)
```bash
# Assicurati che IPFS Desktop sia in esecuzione
python publish_model.py \
    --onnx ../models/m4tr1x_detector.onnx \
    --version 2025.06.01 \
    --accuracy 0.923 \
    --samples 5000 \
    --ipfs \
    --privkey <la-tua-chiave-privata-hex>
```

---

## Aggiornamento automatico nell'app

Quando pubblichi su Nostr, tutti gli utenti M4TR1X riceveranno il modello
al prossimo avvio dell'app — automaticamente, senza nessuna azione richiesta.

L'app verifica il SHA-256 del file prima di installarlo.

---

## Quando smettere di etichettare?

Quando `train.py` riporta **accuratezza ≥ 90%** in validazione, il modello
è abbastanza buono da funzionare in autonomia. A quel punto:
- Il modello etichetta i nuovi video da solo
- I voti della community diventano opzionali (ma aiutano a migliorare ulteriormente)
- Il sistema è auto-sostenuto

---

## API endpoints (per sviluppatori)

| Endpoint | Descrizione |
|----------|-------------|
| `POST /api/v1/train/vote` | Invia un voto |
| `GET /api/v1/train/stats` | Statistiche globali |
| `GET /api/v1/train/stats/:hash` | Stats su un video |
| `GET /api/v1/train/leaderboard` | Classifica contribuenti |
| `GET /api/v1/train/labels` | Etichette confermate (richiede API key) |
| `POST /api/v1/train/sync` | Sincronizza da Nostr |
| `GET /api/v1/train/model/latest` | Versione modello attuale |
