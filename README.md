# 🎵 Bollywood — Kishore Kumar Ultimate Fan Jukebox

Search and listen to Bollywood melodies — a Progressive Web App (PWA) for GitHub Pages.

## Features
- **Bundle 1:** Kishore × Rajesh Khanna (Tier 1 / 2 / 3 with Popularity Meter)
- **Bundle 2:** Composer Vaults — Vol A: R.D. Burman, Vol B: Laxmikant-Pyarelal
- **Bundle 3:** Kishore & Asha Bhosle Duets — Playful / Romantic
- Bilingual search (English / Hinglish / हिंदी) with typo tolerance
- 🎤 Voice Search (Hindi `hi-IN` / English `en-IN`) via Web Speech API — Chrome, Edge, Android
- Musical Trivia of the Day, Favourites, installable, works offline

## Files
| File | Purpose |
|---|---|
| `index.html` | App page |
| `styles.css` | Design (mobile-first) |
| `app.js` | Search engine, voice engine, rendering |
| `songs.json` | Song list + trivia — edit this to add songs |
| `manifest.json` | PWA install settings |
| `service-worker.js` | Offline cache — bump `CACHE_VERSION` after every change |
| `icons/` | App icons |

## Deploy
Settings → Pages → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save.

> Non-commercial fan tribute. "Listen" opens a YouTube search; no audio is hosted here.
