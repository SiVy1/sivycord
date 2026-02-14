# 🦄 SivySpeak

> _A lightweight, secure alternative to Discord. The messenger that respects your RAM and your secrets._

[![Rust](https://img.shields.io/badge/rust-1.77%2B-orange.svg)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/tauri-2.10-blue.svg)](https://tauri.app/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## 🚀 Slogan

**SivySpeak: The messenger that respects your RAM and your secrets.**

---

## ⚡ SivySpeak vs Discord — Comparison Table

| Feature         | **SivySpeak**         | Discord           |
|-----------------|----------------------|-------------------|
| RAM Usage       | **~10MB**             | 400MB+            |
| Privacy         | **End-to-End (E2E)**  | Data Mining       |
| Hosting         | **Self-hosted / P2P** | Centralized       |
| Encryption      | **AES-256-GCM, ECDH** | Optional, not E2E |
| Audio AI        | **Built-in (nnnoiseless)** | External (Krisp) |
| Federation      | **Yes**               | No                |

---

## 🔥 Key Features

- **Ultra-low RAM footprint:** Thanks to Rust and Tauri, SivySpeak uses only ~10MB RAM at idle. No Electron bloat.
- **End-to-End Encryption:** ECDH (P-256) key exchange, AES-256-GCM message encryption. True Zero Knowledge — server never sees your messages.
- **AI Noise Suppression:** Built-in neural noise reduction (`nnnoiseless`), Opus codec, ultra-low latency audio.
- **Federation & P2P:** Connect your own servers, or go fully peer-to-peer. No lock-in, no central authority.
- **Self-hosted & Portable:** Run your own server, or use Docker/Windows installer. Your data, your rules.
- **Modern UI:** React 19, TypeScript, Tailwind — fast, beautiful, and responsive.

---

## ⚡ Quick Start

### Server Installation

**Windows (PowerShell):**
```powershell
# Run as Administrator
cd server
.\install.ps1 -ExternalHost "yourdomain.com"
```

**Docker (Linux/macOS/Windows):**
```bash
cd server
cp .env.example .env   # Edit your settings
docker-compose up -d
```

### Client Installation

- **Ultra-lightweight desktop app:** Download the portable `.exe` (Windows), `.dmg` (macOS), or `.AppImage` (Linux) from Releases.
- **No bloat:** Tauri + Rust backend, React frontend. Fast startup, minimal resources.

---

## 🛡️ Security

- **End-to-End Encryption:** All messages are encrypted client-side. Server operates in Zero Knowledge mode.
- **ECDH Key Exchange:** P-256 for secure key negotiation.
- **AES-256-GCM:** Industry-standard symmetric encryption.
- **No telemetry, no analytics:** Your data stays yours.
- **Federation:** Connect multiple servers, or run fully P2P.

---

## 🧩 Tech Stack

- **Rust** — Backend, audio, crypto, networking
- **Tauri v2** — Secure, lightweight desktop shell
- **React 19** — Modern UI
- **TypeScript** — Type safety everywhere
- **Axum** — Fast, async web server
- **SeaORM** — Database abstraction (SQLite/Postgres)
- **Iroh** — P2P networking & CRDT sync
- **Opus** — High-quality audio codec
- **nnnoiseless** — AI noise suppression

---

## 💡 Why SivySpeak?

- **Minimal RAM, maximal privacy.**
- **No central authority.**
- **Built for cypherpunks, gamers, and anyone who values their data.**

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

**Ready to ditch the bloat and take back your privacy? Try SivySpeak today.**
