// Miniplayer standalone script - runs in the always-on-top window
const miniplayerBg = document.getElementById('miniplayerBg');
const miniplayerContainer = document.getElementById('miniplayerContainer');
const miniplayerCanvas = document.getElementById('miniplayerCanvas');
const miniplayerCtx = miniplayerCanvas ? miniplayerCanvas.getContext('2d') : null;

// State
let parsedLyrics = [];
let currentPosition = 0;
let currentDuration = 0;
let isPlaying = false;
let lastPollTime = Date.now();
let currentAccentColor = '180, 255, 230';
let currentSongId = '';
let lastActiveIndex = -1;
let bgParticlesEnabled = true;
let lyricParticlesEnabled = true;
let activeKaraokeRect = null;

// ===== PARTICLES =====
let particles = [];

if (miniplayerCanvas) {
    function resizeCanvas() {
        miniplayerCanvas.width = window.innerWidth;
        miniplayerCanvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Extract dominant color from image for particles
    function extractDominantColor(imageUrl, callback) {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 50;
            canvas.height = 50;
            ctx.drawImage(img, 0, 0, 50, 50);
            try {
                const data = ctx.getImageData(0, 0, 50, 50).data;
                let r = 0, g = 0, b = 0, count = 0;
                for (let i = 0; i < data.length; i += 16) {
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    count++;
                }
                r = Math.round(r / count);
                g = Math.round(g / count);
                b = Math.round(b / count);
                callback(`${r}, ${g}, ${b}`);
            } catch (e) {
                callback('180, 255, 230'); // Default teal
            }
        };
        img.onerror = () => callback('180, 255, 230');
        img.src = imageUrl;
    }

    class Particle {
        constructor(isEmitter = false, ex = 0, ey = 0) {
            this.isEmitter = isEmitter;
            if (isEmitter) {
                this.x = ex + (Math.random() * 10 - 5);
                this.y = ey + (Math.random() * 10 - 5);
                this.size = Math.random() * 1.5 + 1.2;
                this.speedX = (Math.random() - 0.5) * 1.5;
                this.speedY = (Math.random() - 0.7) * 2.2; // burst upwards
                this.opacity = 1.0;
            } else {
                this.x = Math.random() * miniplayerCanvas.width;
                this.y = Math.random() * miniplayerCanvas.height;
                this.size = Math.random() * 3 + 1.5;
                this.speedX = (Math.random() - 0.5) * 0.3;
                this.speedY = (Math.random() - 0.5) * 0.3 - 0.1;
                this.opacity = Math.random() * 0.6 + 0.3;
            }
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            if (this.isEmitter) {
                this.opacity -= 0.025; // fade out quickly
            } else {
                if (this.y < 0) {
                    this.y = miniplayerCanvas.height;
                    this.x = Math.random() * miniplayerCanvas.width;
                }
                if (this.x < 0) this.x = miniplayerCanvas.width;
                if (this.x > miniplayerCanvas.width) this.x = 0;
            }
        }
        draw() {
            if (!miniplayerCtx) return;
            miniplayerCtx.beginPath();
            miniplayerCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            
            let activeBase = this.isEmitter ? '255, 255, 255' : currentAccentColor;
            
            miniplayerCtx.shadowBlur = this.isEmitter ? 12 : 8;
            miniplayerCtx.shadowColor = `rgba(${currentAccentColor}, 0.8)`;
            miniplayerCtx.fillStyle = `rgba(${activeBase}, ${this.opacity})`;
            miniplayerCtx.fill();
            miniplayerCtx.shadowBlur = 0;
        }
    }

    // Adjust density based on screen size (matching main window's density formula)
    const particleCount = (window.innerWidth * window.innerHeight) / 15000;
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle(false));
    }

    let lastFrame = 0;
    function animateParticles(timestamp) {
        // Spawn lyric-linked particles from the active karaoke letter (subtle, elegant rate of ~15 particles/sec)
        if (lyricParticlesEnabled && activeKaraokeRect && isPlaying && Math.random() < 0.25) {
            let px = activeKaraokeRect.left + (Math.random() * activeKaraokeRect.width);
            let py = activeKaraokeRect.top + (Math.random() * activeKaraokeRect.height);
            particles.push(new Particle(true, px, py));
        }

        if (timestamp - lastFrame < 33) {
            requestAnimationFrame(animateParticles);
            return;
        }
        lastFrame = timestamp;

        if (miniplayerCtx) {
            miniplayerCtx.clearRect(0, 0, miniplayerCanvas.width, miniplayerCanvas.height);
            
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                
                // If bg particles are disabled, skip ambient ones
                if (!bgParticlesEnabled && !p.isEmitter) {
                    continue;
                }
                
                // If lyric particles are disabled, remove emitter ones
                if (!lyricParticlesEnabled && p.isEmitter) {
                    particles.splice(i, 1);
                    continue;
                }
                
                p.update();
                p.draw();
                
                // Remove expired emitter particles
                if (p.isEmitter && p.opacity <= 0) {
                    particles.splice(i, 1);
                }
            }
        }

        requestAnimationFrame(animateParticles);
    }
    requestAnimationFrame(animateParticles);
}

// ===== LYRICS SYNC =====
function updateLyricsDisplay() {
    activeKaraokeRect = null;
    if (parsedLyrics.length === 0) {
        miniplayerContainer.innerHTML = '<div class="miniplayer-line waiting">Waiting for lyrics...</div>';
        lastActiveIndex = -1;
        return;
    }

    // Find active index
    let activeIndex = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
        if (currentPosition >= parsedLyrics[i].time) {
            activeIndex = i;
        } else {
            break;
        }
    }

    if (activeIndex === -1) {
        miniplayerContainer.innerHTML = '<div class="miniplayer-line waiting">Waiting for lyrics...</div>';
        lastActiveIndex = -1;
        return;
    }

    // Only rebuild DOM if active index changed
    if (activeIndex !== lastActiveIndex) {
        lastActiveIndex = activeIndex;
        miniplayerContainer.innerHTML = '';

        // Previous line
        if (activeIndex > 0) {
            const prev = parsedLyrics[activeIndex - 1];
            if (prev && prev.text) {
                const div = document.createElement('div');
                div.className = 'miniplayer-line past';
                if (prev.isHTML) {
                    div.innerHTML = prev.text;
                } else {
                    div.textContent = prev.text;
                }
                miniplayerContainer.appendChild(div);
            }
        }

        // Current active line
        const current = parsedLyrics[activeIndex];
        if (current && current.text) {
            const div = document.createElement('div');
            div.className = 'miniplayer-line active';
            div.id = 'miniplayerActiveLine';

            if (current.isHTML) {
                div.innerHTML = current.text;
            } else {
                // Split into characters for crawling glint
                const chars = current.text.split('');
                chars.forEach(char => {
                    const span = document.createElement('span');
                    span.className = 'lyric-letter';
                    span.textContent = char;
                    div.appendChild(span);
                });
            }
            miniplayerContainer.appendChild(div);
        }

        // Next line
        if (activeIndex < parsedLyrics.length - 1) {
            const next = parsedLyrics[activeIndex + 1];
            if (next && next.text) {
                const div = document.createElement('div');
                div.className = 'miniplayer-line future';
                if (next.isHTML) {
                    div.innerHTML = next.text;
                } else {
                    div.textContent = next.text;
                }
                miniplayerContainer.appendChild(div);
            }
        }
    }

    // Update character crawlers for the current active line every tick
    const activeLineElem = document.getElementById('miniplayerActiveLine');
    if (activeLineElem && !parsedLyrics[activeIndex].isHTML) {
        const letterSpans = activeLineElem.querySelectorAll('.lyric-letter');
        if (letterSpans.length > 0) {
            // Calculate true time until next line
            let crawlDuration = 4.0;
            if (activeIndex + 1 < parsedLyrics.length) {
                crawlDuration = Math.max(0.1, parsedLyrics[activeIndex + 1].time - parsedLyrics[activeIndex].time);
            }

            let maxCrawl = activeLineElem.innerText.length / 3.0;
            maxCrawl = Math.max(maxCrawl, 2.5);
            crawlDuration = Math.min(crawlDuration, maxCrawl);

            let progress = (currentPosition - parsedLyrics[activeIndex].time) / crawlDuration;
            progress = Math.max(0, Math.min(1, progress));

            const exactChar = progress * letterSpans.length;
            const activeLetterIdx = Math.floor(exactChar);
            const fraction = exactChar - activeLetterIdx;

            for (let w = 0; w < letterSpans.length; w++) {
                const sp = letterSpans[w];
                if (w < activeLetterIdx) {
                    sp.style.color = '#ffffff';
                    sp.style.textShadow = 'none';
                    sp.style.background = 'none';
                    sp.style.webkitTextFillColor = 'initial';
                } else if (w > activeLetterIdx) {
                    sp.style.color = 'rgba(255, 255, 255, 0.4)';
                    sp.style.textShadow = 'none';
                    sp.style.background = 'none';
                    sp.style.webkitTextFillColor = 'initial';
                } else {
                    // Fractional sweep across the single letter
                    sp.style.background = `linear-gradient(to right, #ffffff 0%, rgba(${currentAccentColor}, 1) 50%, rgba(255, 255, 255, 0.4) 50.1%, rgba(255, 255, 255, 0.4) 100%)`;
                    sp.style.backgroundSize = `200% 100%`;
                    sp.style.backgroundPosition = `${100 - (fraction * 100)}% 0%`;
                    sp.style.webkitBackgroundClip = 'text';
                    sp.style.webkitTextFillColor = 'transparent';
                    sp.style.textShadow = 'none';

                    if (sp.textContent.trim() !== '') {
                        activeKaraokeRect = sp.getBoundingClientRect();
                    }
                }
            }
        }
    }
}

// Extrapolate position between polls
function tick() {
    if (isPlaying) {
        const now = Date.now();
        const diff = (now - lastPollTime) / 1000;
        lastPollTime = now;
        currentPosition += diff;
        updateLyricsDisplay();
    }
    requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ===== FETCH DATA =====
async function fetchData() {
    try {
        const res = await fetch('http://127.0.0.1:5000/current');
        if (!res.ok) {
            miniplayerBg.style.backgroundImage = "url('Images/Default.png')";
            currentAccentColor = '180, 255, 230';
            return;
        }

        const data = await res.json();

        // Sync shared settings from backend
        if (data.settings) {
            if (data.settings.bgParticlesEnabled !== undefined) {
                bgParticlesEnabled = data.settings.bgParticlesEnabled;
            }
            if (data.settings.lyricParticlesEnabled !== undefined) {
                lyricParticlesEnabled = data.settings.lyricParticlesEnabled;
            }
        }

        // Update background and extract dominant color for particles
        if (data.thumbnail) {
            miniplayerBg.style.backgroundImage = `url('${data.thumbnail}')`;
            // Extract dominant color for particles
            extractDominantColor(data.thumbnail, (color) => {
                currentAccentColor = color;
            });
        } else {
            miniplayerBg.style.backgroundImage = "url('Images/Default.png')";
            currentAccentColor = '180, 255, 230';
        }

        // Check if song changed or if we need to load newly available lyrics
        const newSongId = data.title + data.artist;
        const lyricsLoaded = data.lyrics && data.lyrics !== 'Loading...' && data.lyrics !== 'Waiting for playing...';

        if (newSongId !== currentSongId || (lyricsLoaded && parsedLyrics.length === 0)) {
            if (newSongId !== currentSongId) {
                currentSongId = newSongId;
                parsedLyrics = [];
                lastActiveIndex = -1;
            }
            if (lyricsLoaded) {
                parsedLyrics = parseLRC(data.lyrics);
            }
        }

        // Update position
        currentPosition = data.position || 0;
        currentDuration = data.duration || 0;
        isPlaying = data.is_playing || false;
        lastPollTime = Date.now();

        // Update play/pause icons
        updatePlayPauseIcon();

    } catch (e) {
        console.error('Fetch error:', e);
    }
}

// Parse LRC format (matching main window script.js logic)
function parseLRC(lrcText) {
    const lines = lrcText.split('\n');
    const result = [];
    const timeRegEx = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    lines.forEach(line => {
        const match = timeRegEx.exec(line);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const msStr = match[3];
            const ms = parseInt(msStr, 10);
            const time = minutes * 60 + seconds + (ms / (msStr.length === 3 ? 1000 : 100));
            const text = line.replace(timeRegEx, '').trim();

            const cleaned = text.trim();
            const isMusicMarker = /^[\s\u266A\u266B\u266C]+$/.test(cleaned) ||
                /^\[.*\]$/.test(cleaned) ||
                /^\(?(Instrumental|Music|Guitar|Solo|Beat|Break|Drop|Intro|Outro)\)?$/i.test(cleaned);

            if (cleaned && !isMusicMarker) {
                result.push({ time, text: cleaned, isHTML: false });
            }
        }
    });

    const sorted = result.sort((a, b) => a.time - b.time);
    if (sorted.length > 0 && sorted[0].time > 2) {
        sorted.unshift({ time: 0, text: '<div class="intro-dots"><span></span><span></span><span></span></div>', isHTML: true });
    }
    return sorted;
}

// ===== MEDIA CONTROLS =====
function updatePlayPauseIcon() {
    const playIcon = document.getElementById('iconPlay');
    const pauseIcon = document.getElementById('iconPause');
    if (!playIcon || !pauseIcon) return;

    if (isPlaying) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
    } else {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
    }
}

async function controlMedia(action) {
    try {
        await fetch(`http://127.0.0.1:5000/control/${action}`, { method: 'POST' });
        setTimeout(fetchData, 300);
    } catch (e) {
        console.error('Control error:', e);
    }
}

document.getElementById('btnPrev')?.addEventListener('click', () => controlMedia('prev'));
document.getElementById('btnNext')?.addEventListener('click', () => controlMedia('next'));
document.getElementById('btnPlayPause')?.addEventListener('click', () => {
    controlMedia(isPlaying ? 'pause' : 'play');
    isPlaying = !isPlaying;
    updatePlayPauseIcon();
});

// Close button - hides the miniplayer window via backend API
document.getElementById('miniplayerClose')?.addEventListener('click', async () => {
    try {
        await fetch('http://127.0.0.1:5000/miniplayer/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ show: false })
        });
    } catch (e) {
        console.error('Failed to close miniplayer:', e);
    }
});

// Poll every 2 seconds
setInterval(fetchData, 2000);
fetchData();
