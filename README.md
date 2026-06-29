<div align="center">

# M4TR1X

[![Release](https://img.shields.io/github/v/release/H8db0y/m4tr1x-electron)](https://github.com/H8db0y/m4tr1x-electron/releases)
[![License](https://img.shields.io/github/license/H8db0y/m4tr1x-electron)](LICENSE)
[![Build](https://github.com/H8db0y/m4tr1x-electron/actions/workflows/build.yml/badge.svg)](https://github.com/H8db0y/m4tr1x-electron/actions)

**A decentralized social network. No central server. No company. No identity verification.**

🌐 **Official site & downloads — [nderja.com](https://nderja.com)**
_M4TR1X is distributed only from nderja.com._

</div>
# ⚡ M4TR1X UI Preview

<p align="center">
  <img src="https://github.com/user-attachments/assets/eb5e9db6-634b-4cd1-9bf5-4c3ae0b4d951" width="100%" alt="Connecting to Relays" />
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/0e49d621-25b1-424e-90a8-016db1ee8229" width="31%" />
  <img src="https://github.com/user-attachments/assets/d4f53911-09f4-4591-bce8-758a3dedf515" width="31%" />
  <img src="https://github.com/user-attachments/assets/ee34044a-a41d-482d-bafb-7811da8b5b65" width="31%" />
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/b8d12d9b-d0e8-4b32-812d-315ab1a9ec23" width="31%" />
  <img src="https://github.com/user-attachments/assets/bf7ef293-41ea-4dac-a658-0dfb739d0273" width="31%" />
</p>
---

## Why M4TR1X exists

The EU is moving toward mandatory identity verification for social media access — through the DSA framework, age verification proposals, and digital identity schemes. The premise is that platforms must know who their users are. M4TR1X is built on the opposite premise: that a social network can function without ever knowing who you are, because there is no central system to ask.

In 2024–2025, EU regulators began requiring mechanisms that would force users to prove their age or identity before accessing social platforms. The stated goals are legitimate — protecting minors, reducing abuse. The structural consequence is a centralized registry of who uses which platform, controllable by whoever controls the platform.

M4TR1X has no central server. It has no user database. Your identity is a cryptographic key pair that lives on your device. There is no company to send a compliance notice to, no database to subpoena, no algorithm deciding what you see. This is not a political statement — it is an architectural choice with political consequences.

---

## What M4TR1X is

M4TR1X is a decentralized social network that runs on a network of community nodes — regular computers that anyone can set up. One account gives you access to:

- Post text and images
- Upload and watch videos
- Share music
- Write in forums
- Send end-to-end encrypted messages
- Sell things

Your identity is tied to a cryptographic key that only you control — not to an email address, a phone number, or any account registered with a platform.

Content lives on nodes, not in a datacenter. When you upload a video it goes to a node on the M4TR1X network and stays there. Node operators earn 30% of every tip that passes through their node, automatically.

The tipping currency is the **H8 token** — a closed utility token that exists only inside M4TR1X. You cannot trade it on exchanges. Tipping costs something, so signal beats spam without needing a moderation team.

The network routes over **Tor by default**. If you are on a censored network, M4TR1X detects it and routes through Tor automatically.

---

## Status

**Developer Preview — v2.3.0**

Stable enough to self-host and contribute to. Not yet recommended for high-risk use cases. The first public node is live.

---

## Security model

- Every account uses **ML-DSA-65 post-quantum signatures** (NIST FIPS-204)
- Private keys are encrypted on disk with **AES-256-GCM**
- No account recovery — if you lose your password, your account is gone. Keep it safe.
- No phone number, no email, no identity linked to your account

---

## Install

Download the binary for your OS from [Releases](https://github.com/H8db0y/m4tr1x-electron/releases/latest).

Before running, verify the SHA-256 checksum against `checksums-*.txt` in the same release.

**Supported:** Windows, macOS (Intel + Apple Silicon), Linux (Debian/Ubuntu)

---

## Build from source

```bash
git clone https://github.com/H8db0y/m4tr1x-electron.git
cd m4tr1x-electron
npm install
cd server && npm install && cd ..
cp .env.example .env
npm start
```

The app runs at `http://localhost:8080/app`.

---

## Run a node

Anyone can run a node. A node stores content (videos, music, posts) locally and makes it available to the network. Node operators earn 30% of tips automatically.

See [`docs/NODE_OPERATOR.md`](docs/NODE_OPERATOR.md) for setup instructions.
For the standalone backend: [m4tr1x-node](https://github.com/H8db0y/m4tr1x-node).

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Electron main process                      │
│    │  - CSP enforcement                     │
│    │  - Sandboxed renderer (Chromium)       │
│    │  - Tor SOCKS5 auto-detection           │
│    │  - Starts Express server in-process    │
│    ▼                                        │
│  http://127.0.0.1:8080  (Express API)       │
│    │                                        │
│    ├── h8identity.js   ML-DSA65 keypairs    │
│    ├── h8token.js      Hash-chain ledger    │
│    ├── relay.js        Embedded relay :4848 │
│    ├── peertube.js     Local video storage  │
│    ├── mastodon.js     Local forum storage  │
│    ├── funkwhale.js    Local music storage  │
│    ├── crowdtrain.js   Distributed labels   │
│    ├── ai_detector.js  ONNX deepfake detect │
│    ├── tor.js          SOCKS5 auto-detect   │
│    └── node_manager.js Node discovery       │
│                                             │
│  ws://0.0.0.0:4848  (M4TR1X relay)          │
│    └── accessible to M4TR1X peers only      │
└─────────────────────────────────────────────┘
```

Full details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Tokenomics

H8 is a utility token that only works inside M4TR1X, similar to how Twitch Bits work inside Twitch. You cannot trade it on exchanges. Minting is controlled by the founder key. Full model in [docs/TOKENOMICS.md](docs/TOKENOMICS.md).

---

## Roadmap

| Version | Status | Notes |
|---------|--------|-------|
| v2.3.0 | Released | Developer Preview. First public node live. |
| v2.3.1 | Planned | Upload access restricted to verified M4TR1X accounts |
| v2.4 | Planned | Public Beta — onboarding wizard, DSA compliance reporting, Android/iOS builds |
| v3.0 | Planned | Independent security audit, multi-language UI, full-disk encryption integration |

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Security issues go to [SECURITY.md](SECURITY.md).

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

Built by [@H8db0y](https://github.com/H8db0y)

</div>
