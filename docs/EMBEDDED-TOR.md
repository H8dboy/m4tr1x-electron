# M4TR1X Embedded Tor - Guida Completa

## Panoramica

M4TR1X v2.4.0+ include un **daemon Tor bundato** che si avvia automaticamente all'app startup. Non serve alcuna configurazione — Tor è **incluso direttamente nel `.exe`/`.dmg`/`.AppImage`**.

### Funzionamento

1. **Utente scarica M4TR1X** (150-180 MB, Tor incluso)
2. **Installa l'app**
3. **Apre l'app** → Tor parte automaticamente
4. **Si connette ai relay** (normali o `.onion`) → **tutto passa per Tor**
5. **Zero configurazione, anonimato garantito** 🧅

---

## Cascata di Rilevazione Tor

M4TR1X prova Tor in questo ordine:

```
1️⃣ Tor Browser in esecuzione (porta 9150)
   ↓ (se non trovato)
2️⃣ Tor daemon standalone (porta 9050)
   ↓ (se non trovato)
3️⃣ Tor embedded bundato ← NUOVO
   ↓ (se tutto fallisce)
4️⃣ Bridge pre-configurati (fallback manuale)
```

**Vantaggio:** Se l'utente ha già Tor Browser aperto, lo usa. Se no, avvia automaticamente quello bundato.

---

## Setup Iniziale

### Solo la prima volta:

```bash
# Scarica i binari Tor ufficiali (solo una volta)
npm run download-tor-binaries

# Output:
# [TOR] Scaricando Windows x64...
# [TOR] Scaricando Windows x86...
# [TOR] Scaricando macOS x64...
# [TOR] Scaricando macOS arm64 (M1/M2)...
# [TOR] Scaricando Linux x64...
# [TOR] Scaricando Linux arm64...
# [TOR] ✅ Tutti i binari Tor pronti!
```

I file si salvano in `./tor-bin/`:

```
tor-bin/
├── win/
│   ├── tor.exe (x64)
│   └── tor-x86.exe (x86)
├── macos/
│   ├── tor-x64
│   └── tor-arm64
└── linux/
    ├── tor-x64
    └── tor-arm64
```

---

## Build per la Distribuzione

Ora quando builderi l'app, **Tor è incluso nel bundle**:

```bash
# Windows
npm run build:win
# → Crea: m4tr1x-setup.exe (160 MB con Tor dentro)
# → + m4tr1x-portable.exe

# macOS
npm run build:mac
# → Crea: m4tr1x.dmg (180 MB con Tor dentro)
# → + m4tr1x.zip

# Linux
npm run build:linux
# → Crea: m4tr1x.AppImage (170 MB con Tor dentro)
# → + m4tr1x.deb
```

---

## Log e Debug

All'avvio, M4TR1X scrive i log in:

### Windows
```
C:\Users\{username}\AppData\Roaming\m4tr1x\.tor\tor.log
```

### macOS
```
~/.m4tr1x/.tor/tor.log
```

### Linux
```
~/.m4tr1x/.tor/tor.log
```

**Per leggere i log:**
```bash
tail -f ~/.m4tr1x/.tor/tor.log
```

---

## Architetture Supportate

| Piattaforma | x64 | x86 | arm64 (M1/M2) |
|-------------|-----|-----|---------------|
| **Windows** | ✅  | ✅  | —             |
| **macOS**   | ✅  | —   | ✅            |
| **Linux**   | ✅  | —   | ✅            |

---

## Problemi Comuni

### ❌ "Binario Tor non trovato"

**Causa:** Script di download non eseguito

**Soluzione:**
```bash
npm run download-tor-binaries
```

### ❌ "Timeout avvio Tor (30s)"

**Causa:** Binario Tor corrotto o incompatibile

**Soluzione:**
```bash
# Rimuovi e riscarica
rm -rf tor-bin/
npm run download-tor-binaries
```

### ❌ Porta 9050 già in uso

**Causa:** Tor daemon precedente non fermato

**Soluzione:**
```bash
# Windows
taskkill /IM tor.exe /F

# macOS/Linux
killall tor
```

### ❌ "Permission denied" su Linux/macOS

**Causa:** Binari Tor non hanno permessi di esecuzione

**Soluzione:**
```bash
chmod +x tor-bin/linux/tor-*
chmod +x tor-bin/macos/tor-*
```

---

## Testing

### Verificare che Tor sia attivo

**Nel console dell'app:**
```javascript
await window.m4tr1x_native.getTorStatus()
// Output: { torEnabled: true, port: 9050, source: "M4TR1X Embedded Tor" }
```

**Oppure dal terminale:**
```bash
curl --socks5 127.0.0.1:9050 https://ifconfig.me
# Se funziona, mostra un indirizzo IP diverso dal tuo
```

---

## Per Utenti in Paesi Censurati

Se il tuo ISP blocca Tor, usa i **bridge pre-configurati**.

I bridge (obfs4, Snowflake, meek-azure) sono inclusi nel codice.

**Iran/Cina:** Snowflake consigliato (sembra WebRTC)
**Russia/Bielorussia:** obfs4 consigliato (veloce e stabile)

---

## Architettura Interna

```
┌─────────────────────┐
│   M4TR1X Electron   │
│   ┌───────────────┐ │
│   │   main.js     │ │ → setupTorIfAvailable()
│   └───────────────┘ │
│        ↓            │
│   ┌───────────────┐ │
│   │  server/tor.js│ │ → Cascata rilevazione
│   └───────────────┘ │
│        ↓            │
│   ┌──────────────┐  │
│   │tor-embedded  │  │ → Avvia daemon
│   │    .js       │  │    se necessario
│   └──────────────┘  │
│        ↓            │
│   ┌──────────────┐  │
│   │  tor-bin/    │  │
│   │  [binaries]  │  │
│   └──────────────┘  │
└─────────────────────┘
        ↓
┌─────────────────────┐
│   SOCKS5 Proxy      │
│  127.0.0.1:9050    │
└─────────────────────┘
        ↓
┌─────────────────────┐
│   Tor Network       │
│   (invisibile ISP)  │
└─────────────────────┘
        ↓
┌─────────────────────┐
│  Relay Nostr        │
│  .onion o normale   │
└─────────────────────┘
```

---

## Aggiornamenti Futuri

Per aggiornare a una versione Tor più recente:

1. Modifica `TOR_VERSION` in `scripts/download-tor-binaries.js`
2. Esegui: `npm run download-tor-binaries`
3. Testa: `npm start`
4. Commit e push: `git commit -am 'chore: update Tor binaries to v14.x.x'`

---

## Sicurezza

- ✅ Tor gira **in-process**, nessun server esterno
- ✅ Configurazione automatica, zero errori utente
- ✅ Log salvati localmente con permessi 0o600 (solo proprietario può leggere)
- ✅ Daemon fermato pulitamente all'exit dell'app
- ✅ SOCKS proxy isolato su localhost (non esposto in rete)

---

## FAQ

**D: Tor rallenta la connessione?**
A: Sì, ~100-500ms di latenza extra. È normale e accettabile per massima privacy.

**D: Posso disabilitare Tor?**
A: No. M4TR1X è progettato per massima privacy. Se non vuoi Tor, usa una VPN.

**D: E se mi trovo in un paese senza Tor?**
A: I bridge pre-configurati aiutano. Se nemmeno i bridge funzionano, contatta support.

**D: Quanto spazio occupa?**
A: ~50 MB per i binari Tor (su disco). Nel runtime, ~10-20 MB di RAM.

**D: È open source?**
A: Sì! M4TR1X e Tor sono entrambi open source (MIT e BSD rispettivamente).

---

**Enjoy total privacy!** 🧅
