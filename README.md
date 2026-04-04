# Lyrical 🎵

A premium Windows Desktop lyrics viewer that automatically synchronizes with exactly what you are listening to on your PC. It hooks directly into the Windows Media API natively, ensuring zero-delay tracking across Spotify, Apple Music, and local media players, displaying synchronized lyrics with a dynamic, highly polished aesthetic.

![Lyrical Demo](demo.png)

## Features 🌟
- **Real-time Engine**: Hooks natively to your OS without needing Spotify/Apple API tokens or developer setups.
- **Dynamic Styling**: Automatically extracts a saturated color palette from the currently playing album art and applies it globally to the application.
- **Micro-Animations**: Smooth, karaoke-style letter sweep gradients with interactive glowing particle emitters matching the lyrics location.
- **Zero Configuration**: Packaged as a single local Windows Executable.

## Technical Notes & Limitations ⚠️
Lyrical was built to look like a premium corporate app without the corporate budget!
- **Line-by-Line vs Word-for-Word**: Lyrical pulls lyrics dynamically via the free, open-source [LRCLIB](https://lrclib.net/) database. Because this is a free community API rather than a multi-million dollar corporate ecosystem (like MusixMatch used by Apple/Spotify), the lyrics are provided with timestamps for the **start of the line**, rather than timestamped per-syllable.
- Our JavaScript engine extrapolates the singing speed based on standard phonetic rhythms to sweep a glint across the text. Because it's mathematically guessing the exact word the singer is on, it's not a 100% physically accurate karaoke machine — but for a beautiful desk-side lyric viewer, it's incredibly accurate and looks amazing!

## How to Run 🚀
**Option 1: Using the Executable (Easy)**
1. Download `Lyrical.exe` from the latest Release.
2. Double-click it. It will open its own dedicated app window!

**Option 2: Running Source Code**
1. Ensure Python 3.10+ is installed.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the backend engine:
   ```bash
   python backend.py
   ```

## Stack
- **Backend**: Python (Flask, `winsdk` for system media control, `pywebview` for the native window wrapper).
- **Frontend**: Vanilla HTML/JS, CSS3 Variables, Canvas-based particle rendering.
