# Contributing to M4TR1X

M4TR1X is a community project. Every contribution matters — from bug reports to translations to new features. If you believe in decentralized truth, you're already part of this.

## Getting Started

```bash
git clone https://github.com/H8dboy/m4tr1x.git
cd m4tr1x
npm install
npm start
```

**Requirements:**
- Node.js 18+
- ffmpeg installed (`brew install ffmpeg` / `apt install ffmpeg` / [ffmpeg.org](https://ffmpeg.org))
- ExifTool (optional, for metadata stripping): [exiftool.org](https://exiftool.org)

## Project Structure

```
m4tr1x/
├── main.js              # Electron entry point + Tor detection
├── preload.js           # Secure renderer ↔ main bridge
├── server/
│   ├── index.js         # Express API server
│   ├── nostr.js         # Nostr protocol (NIP-01, NIP-44)
│   ├── mastodon.js      # Mastodon / ActivityPub
│   ├── peertube.js      # PeerTube federation
│   ├── funkwhale.js     # Funkwhale music
│   ├── ai_detector.js   # ONNX AI video detection
│   ├── monero.js        # Monero wallet
│   ├── shop.js          # Decentralized marketplace
│   ├── tor.js           # Tor auto-detection
│   ├── uploader.js      # AES-256-GCM video encryption
│   ├── core.js          # ExifTool metadata scrubbing
│   └── db.js            # SQLite
├── frontend/
│   ├── index.html       # Main PWA frontend
│   └── auth.html        # Nostr authentication
└── models/
    └── m4tr1x_detector.onnx   ← AI model (generate with train_detector.py)
```

## How to Contribute

### Reporting bugs
Open a GitHub issue with:
- Steps to reproduce
- Expected vs actual behavior
- Your OS and Node.js version

### Submitting code

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Write clear, commented code
4. Test locally with `npm start`
5. Submit a Pull Request with a description of what it does and why

### Priority areas

These are the things that matter most right now:

- **AI model training** — The ONNX model needs training data with real vs AI-generated videos. If you have a dataset or can help collect one, open an issue.
- **Tor bridge support** — Help users in heavily censored countries connect through Tor bridges (obfs4, meek).
- **Mobile app** — React Native + ONNX Mobile port for Android/iOS.
- **Translations** — The interface needs to be accessible in Arabic, Farsi, Russian, and other languages of people who need this most.
- **IPFS integration** — Auto-pin verified videos to IPFS for permanent storage.
- **Relay discovery** — Automatically find and connect to the best Nostr relays for the user's region.

### Code style

- Clear variable names, comments in English or Italian (both fine)
- No secrets in code (use `.env`)
- Error handling on every async function
- No `console.log` with sensitive data (keys, seeds, passwords)

## Values

M4TR1X is built for people who need it most. Every decision should be evaluated against this question: **does this make the tool safer and more useful for someone in a dangerous situation?**

Privacy is not a feature. It's the foundation.

---

> *"In the age of synthetic reality, authenticity is the new resistance."*
