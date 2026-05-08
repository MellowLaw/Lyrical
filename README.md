<div align="center">

# 🎵 Lyrical

**Premium Desktop Lyrics Experience for Windows**

[![Python](https://img.shields.io/badge/Python-3.10+-blue?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://www.microsoft.com/windows)

---

Lyrical is a high-end Windows application that transforms your desktop into a beautiful, synchronized lyric display. It hooks directly into the Windows Media Layer to provide zero-configuration tracking for almost any music player.

[**Download Latest Release**](https://github.com/YOUR_USERNAME/YOUR_REPO/releases) • [**Report Bug**](https://github.com/YOUR_USERNAME/YOUR_REPO/issues)

<img src="Images/demo.png" alt="Lyrical Demo" width="800" style="border-radius: 20px; box-shadow: 0 20px 50px rgba(0,0,0,0.3);">

</div>

## ✨ Key Features

- **🎯 Native Universal Sync**: No API tokens or Spotify developer setups required. If Windows says it's playing, Lyrical shows it.
- **🎨 Dynamic Color Engine**: Automatically samples the dominant colors of your album art to create a saturated, immersive atmosphere.
- **✨ Apple-Grade Glassmorphism**: Stunning "Liquid Glass" UI with high-saturation blurs and depth-based reflections.
- **🔥 Particle Emitters**: Interactive glowing particles that emerge from the lyrics as they are sung.
- **📱 Dual-Mode Layout**: Switch instantly between the immersive **Apple Layout** and the classic, clean **Spotify Layout**.

---

## 🛠️ How It Works

### The Magic of the Sync
Lyrical doesn't just display text; it interprets it. Using the open-source [LRCLIB](https://lrclib.net/) database, the app fetches high-quality synced lyrics. 

Our custom **Phonetic Extrapolation Engine** then calculates the likely singing speed of each word. While it's mathematically "guessing" the rhythm between lines, the result is a smooth, professional karaoke sweep that feels alive.

### Security & Privacy 🔒
- **100% Local**: No personal data, passwords, or music history ever leaves your machine.
- **Secure Backend**: The internal communication is restricted via CORS to ensure only the Lyrical window can talk to the backend.

---

## 🚀 Getting Started

### Option 1: Standalone (Recommended)
1. Download `Lyrical.exe` from the [Releases](https://github.com/YOUR_USERNAME/YOUR_REPO/releases) page.
2. Run it. That's it!

### Option 2: From Source
1. **Clone the repo**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
   ```
2. **Install requirements**:
   ```bash
   pip install -r requirements.txt
   ```
3. **Launch**:
   ```bash
   python backend.py
   ```

---

## 🏗️ Built With

- **Backend**: Python (Flask, Windows SDK, PyWebView)
- **Frontend**: Vanilla JS, HTML5 Canvas, Modern CSS3
- **Data Source**: LRCLIB Community API

---

<div align="center">
  Made with ❤️ by Lawrence
</div>
