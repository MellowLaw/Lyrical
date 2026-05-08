// --- PARTICLES ENGINE ---
const canvas = document.getElementById('glintCanvas');
const ctx = canvas.getContext('2d');

let particlesArray = [];
let activeKaraokeRect = null;
let currentAccentColor = '180, 255, 230'; // Default teal glint

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Particle {
    constructor(isEmitter = false, ex = 0, ey = 0) {
        this.isEmitter = isEmitter;
        if (isEmitter) {
            this.x = ex + (Math.random() * 15 - 7.5);
            this.y = ey + (Math.random() * 15 - 7.5);
            this.size = Math.random() * 2 + 1.5;
            this.speedX = (Math.random() - 0.5) * 2;
            this.speedY = (Math.random() - 0.7) * 3; // burst upwards
            this.opacity = 1.0;
            this.baseColor = '255, 255, 255';
            this.glowColor = currentAccentColor;
        } else {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 3 + 1;
            this.speedX = Math.random() * 1 - 0.5;
            this.speedY = Math.random() * -1 - 0.5; // Drift upwards
            this.opacity = Math.random() * 0.5 + 0.1;
            this.baseColor = currentAccentColor;
            this.glowColor = currentAccentColor;
        }
    }
    update() {
        // Phonk mode goes WILD
        let multiplier = window.isPhonkMode ? 4 : 1;

        // Add some jitter for phonk
        if (window.isPhonkMode && !this.isEmitter) {
            this.x += (Math.random() - 0.5) * 5;
            this.y += (Math.random() - 0.5) * 5;
        }

        this.x += this.speedX * multiplier;
        this.y += this.speedY * multiplier;

        if (this.isEmitter) {
            this.opacity -= 0.02; // fade out quickly
            this.color = `rgba(255, 255, 255, ${this.opacity})`;
        } else {
            // Reset ambient if goes off screen
            if (this.y < 0) {
                this.y = canvas.height;
                this.x = Math.random() * canvas.width;
            }
        }
    }
    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);

        // Dynamically grab global accent color so ALL particles switch instantly on song change
        let activeBase = this.isEmitter ? '255, 255, 255' : currentAccentColor;

        // Add glow
        ctx.shadowBlur = 15 + (this.isEmitter ? 5 : 0);
        ctx.shadowColor = `rgba(${currentAccentColor}, 0.8)`;

        ctx.fillStyle = `rgba(${activeBase}, ${this.opacity})`;
        ctx.fill();
        ctx.shadowBlur = 0; // reset
    }
}

function initParticles() {
    particlesArray = [];
    // Adjust density based on screen size
    const particleCount = (window.innerWidth * window.innerHeight) / 15000;
    for (let i = 0; i < particleCount; i++) {
        particlesArray.push(new Particle());
    }
}

let lyricParticlesEnabled = true;
let bgParticlesEnabled = true;
let appleLayoutEnabled = false;

try {
    const saved = localStorage.getItem('lyricalSettings');
    if (saved) {
        const s = JSON.parse(saved);
        lyricParticlesEnabled = s.lyricParticlesEnabled !== undefined ? s.lyricParticlesEnabled : true;
        bgParticlesEnabled = s.bgParticlesEnabled !== undefined ? s.bgParticlesEnabled : true;
        appleLayoutEnabled = s.appleLayoutEnabled !== undefined ? s.appleLayoutEnabled : true;
        if (document.getElementById('lyricParticlesToggle')) document.getElementById('lyricParticlesToggle').checked = lyricParticlesEnabled;
        if (document.getElementById('bgParticlesToggle')) document.getElementById('bgParticlesToggle').checked = bgParticlesEnabled;

        if (!appleLayoutEnabled) {
            document.body.classList.add('spotify-layout');
        }
    }
} catch (e) { }

function applyLayoutMode(isApple) {
    appleLayoutEnabled = isApple;
    document.body.classList.toggle('spotify-layout', !isApple);
    const seg = document.getElementById('layoutSegmented');
    if (seg) {
        seg.querySelectorAll('.segmented-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.layout === (isApple ? 'apple' : 'spotify'));
        });
    }
    localStorage.setItem('lyricalSettings', JSON.stringify({ lyricParticlesEnabled, bgParticlesEnabled, appleLayoutEnabled }));
}

function animateParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (bgParticlesEnabled || lyricParticlesEnabled) {
        // Spawn text-linked particles from the active karaoke letter
        if (lyricParticlesEnabled && activeKaraokeRect) {
            let px = activeKaraokeRect.left + (Math.random() * activeKaraokeRect.width);
            let py = activeKaraokeRect.top + (Math.random() * activeKaraokeRect.height);
            particlesArray.push(new Particle(true, px, py));
        }

        for (let i = particlesArray.length - 1; i >= 0; i--) {
            const p = particlesArray[i];
            // Skip ambient particles if bg particles are disabled
            if (!bgParticlesEnabled && !p.isEmitter) {
                continue;
            }
            // Skip lyric emitter particles if lyric particles are disabled
            if (!lyricParticlesEnabled && p.isEmitter) {
                particlesArray.splice(i, 1);
                continue;
            }
            p.update();
            p.draw();

            if (p.isEmitter && p.opacity <= 0) {
                particlesArray.splice(i, 1);
            }
        }
    }
    requestAnimationFrame(animateParticles);
}

initParticles();
animateParticles();

// --- LYRICS LOGIC ---

let currentSongId = "";
let parsedLyrics = []; // Array of { time: seconds, text: "string" }
let isPlaying = false;
let currentPosition = 0; // In seconds
let lastPollTime = Date.now();
let rawLyrics = ""; // Track raw lyrics string to detect changes
const container = document.getElementById('lyricsContainer');

function parseLRC(lrcText) {
    const lines = lrcText.split('\n');
    const result = [];

    // Regex to match [mm:ss.xx]
    const timeRegEx = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    lines.forEach(line => {
        const match = timeRegEx.exec(line);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const msStr = match[3];
            const ms = parseInt(msStr, 10);
            // Handle MS depending on whether it provides 2 digits (e.g. 50 = 500ms) or 3 digits
            const time = minutes * 60 + seconds + (ms / (msStr.length === 3 ? 1000 : 100));
            const text = line.replace(timeRegEx, '').trim();

            // Filter out purely instrumental/empty placeholders so the crawling math naturally skips breaks
            const cleaned = text.trim();
            // Drop lines that are purely musical notes, structural tags like [Chorus], or (Instrumental) variations
            const isMusicMarker = /^[\s\u266A\u266B\u266C]+$/.test(cleaned) ||
                /^\[.*\]$/.test(cleaned) ||
                /^\(?(Instrumental|Music|Guitar|Solo|Beat|Break|Drop|Intro|Outro)\)?$/i.test(cleaned);

            if (cleaned && !isMusicMarker) {
                result.push({ time, text: cleaned });
            }
        }
    });
    const sorted = result.sort((a, b) => a.time - b.time);
    if (sorted.length > 0 && sorted[0].time > 2) {
        sorted.unshift({ time: 0, text: '<div class="intro-dots"><span></span><span></span><span></span></div>', isHTML: true });
    }
    return sorted;
}

function renderLyrics() {
    container.innerHTML = '';
    if (parsedLyrics.length === 0) {
        const div = document.createElement('div');
        div.className = 'lyric-line';
        div.innerText = "No synchronized lyrics found.";
        container.appendChild(div);
        return;
    }

    // Create an empty space at the end to make sure the last line scrolls up nicely
    parsedLyrics.forEach((line, index) => {
        const div = document.createElement('div');
        div.className = 'lyric-line';
        div.id = `line-${index}`;

        if (line.isHTML) {
            div.innerHTML = line.text;
        } else {
            // Render letter-by-letter to allow pixel-perfect smooth crawling
            const chars = line.text.split('');
            chars.forEach(char => {
                const span = document.createElement('span');
                span.className = 'lyric-letter';
                span.textContent = char;
                div.appendChild(span);
            });
        }
        container.appendChild(div);
    });

    const filler = document.createElement('div');
    filler.style.height = "50vh"; // Push the last element up when complete
    container.appendChild(filler);
}

function updateLyricsDisplay() {
    if (parsedLyrics.length === 0) return;

    // Find active line (the latest line whose time is <= currentPosition)
    let activeIndex = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
        if (currentPosition >= parsedLyrics[i].time) {
            activeIndex = i;
        } else {
            break;
        }
    }

    const lines = document.getElementsByClassName('lyric-line');

    // Calculate scroll offset
    // We want the active line to be in the center
    let targetY = 0;
    if (activeIndex !== -1 && lines[activeIndex]) {
        const activeElem = lines[activeIndex];
        targetY = activeElem.offsetTop - (window.innerHeight / 2) + (activeElem.clientHeight / 2);
    }

    activeKaraokeRect = null; // reset global tracker

    // Update classes
    for (let i = 0; i < lines.length; i++) {
        lines[i].classList.remove('active', 'past');
        const letterSpans = lines[i].querySelectorAll('.lyric-letter');

        if (i === activeIndex) {
            lines[i].classList.add('active');

            if (parsedLyrics[i].isHTML) continue;

            // Calculate true time until next line
            let crawlDuration = 4.0;
            if (i + 1 < parsedLyrics.length) {
                crawlDuration = Math.max(0.1, parsedLyrics[i + 1].time - parsedLyrics[i].time);
            }

            // The user felt it was "too fast". This was because our maxCrawl limit was too aggressive,
            // forcing slow, emotional singing to crawl very quickly. We now apply a much looser cap
            // so we ONLY artificially speed it up on massive instrumental breaks!
            // 3 chars per second is very slow singing.
            let maxCrawl = lines[i].innerText.length / 3.0;
            maxCrawl = Math.max(maxCrawl, 2.5); // At least 2.5 seconds even for a short word
            crawlDuration = Math.min(crawlDuration, maxCrawl);

            let progress = (currentPosition - parsedLyrics[i].time) / crawlDuration;
            progress = Math.max(0, Math.min(1, progress));

            const exactChar = progress * letterSpans.length;
            const activeLetterIdx = Math.floor(exactChar);
            const fraction = exactChar - activeLetterIdx;

            // Smoothly traverse letter-by-letter
            for (let w = 0; w < letterSpans.length; w++) {
                const sp = letterSpans[w];
                if (w < activeLetterIdx) {
                    sp.style.color = '#ffffff';
                    sp.style.textShadow = '0 0 20px rgba(255, 255, 255, 0.6)';
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
        } else if (i < activeIndex) {
            lines[i].classList.add('past');
            letterSpans.forEach(sp => {
                sp.style.color = 'rgba(255, 255, 255, 0.15)';
                sp.style.textShadow = 'none';
                sp.style.background = 'none';
                sp.style.webkitTextFillColor = 'initial';
            });
        } else {
            letterSpans.forEach(sp => {
                sp.style.color = 'rgba(255, 255, 255, 0.4)';
                sp.style.textShadow = 'none';
                sp.style.background = 'none';
                sp.style.webkitTextFillColor = 'initial';
            });
        }
    }

    if (activeIndex !== -1) {
        container.style.transform = `translateY(-${targetY}px)`;
    } else {
        container.style.transform = `translateY(0px)`;
    }
}

// Poll the backend
async function fetchCurrentSong() {
    try {
        const res = await fetch('http://127.0.0.1:5000/current');
        if (!res.ok) {
            document.getElementById('songTitle').innerText = "Not Playing";
            document.getElementById('songArtist').innerText = "Start music for lyrics...";
            // Show default image when not playing
            const albumArt = document.getElementById('albumArt');
            const miniAlbumArt = document.getElementById('miniAlbumArt');
            albumArt.src = 'Images/Default.png';
            albumArt.style.display = 'block';
            miniAlbumArt.src = 'Images/Default.png';
            miniAlbumArt.style.display = 'block';
            document.getElementById('blurredBackground').style.backgroundImage = "url('Images/Default.png')";
            document.getElementById('sidebar').style.backgroundImage = "url('Images/Default.png')";
            currentAccentColor = '180, 255, 230';
            return;
        }
        const data = await res.json();

        document.getElementById('songTitle').innerText = data.title;
        document.getElementById('songArtist').innerText = data.artist;
        document.getElementById('miniSongTitle').innerText = data.title;
        document.getElementById('miniSongArtist').innerText = data.artist;

        isPlaying = data.is_playing;
        lastPollTime = Date.now();

        updatePlayPauseIcons();

        const songId = `${data.title}-${data.artist}`;
        if (songId !== currentSongId) {
            currentSongId = songId;
            rawLyrics = data.lyrics; // Reset raw lyrics for new song

            const albumArt = document.getElementById('albumArt');
            const miniAlbumArt = document.getElementById('miniAlbumArt');
            const sidebar = document.getElementById('sidebar');
            if (data.thumbnail) {
                albumArt.src = data.thumbnail;
                albumArt.style.display = 'block';
                miniAlbumArt.src = data.thumbnail;
                miniAlbumArt.style.display = 'block';
                document.getElementById('blurredBackground').style.backgroundImage = `url('${data.thumbnail}')`;
                sidebar.style.backgroundImage = `url('${data.thumbnail}')`;
                albumArt.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    // Sample the image into a 50x50 grid
                    canvas.width = 50;
                    canvas.height = 50;
                    ctx.drawImage(albumArt, 0, 0, 50, 50);
                    const data = ctx.getImageData(0, 0, 50, 50).data;

                    let highestCount = 0;
                    let dominantRGB = { r: 50, g: 50, b: 50 }; // safe fallback

                    // Simple bucketing to find the most common color
                    const buckets = {};
                    for (let i = 0; i < data.length; i += 4) {
                        let r = data[i];
                        let g = data[i + 1];
                        let b = data[i + 2];
                        let a = data[i + 3];

                        if (a < 255) continue; // Ignore transparent

                        // Quantize colors to group similar ones
                        let qr = Math.round(r / 24) * 24;
                        let qg = Math.round(g / 24) * 24;
                        let qb = Math.round(b / 24) * 24;

                        // Ignore pure grays, blacks, and whites to find the VIBE color
                        let max = Math.max(r, g, b);
                        let min = Math.min(r, g, b);
                        if (max - min < 20) continue; // Very low saturation (grays)
                        if (max < 40 || max > 240) continue; // Too dark or too bright

                        let key = `${qr},${qg},${qb}`;
                        if (!buckets[key]) {
                            buckets[key] = { count: 0, r: 0, g: 0, b: 0 };
                        }
                        buckets[key].count++;
                        buckets[key].r += r;
                        buckets[key].g += g;
                        buckets[key].b += b;

                        if (buckets[key].count > highestCount) {
                            highestCount = buckets[key].count;
                            dominantRGB = {
                                r: Math.floor(buckets[key].r / buckets[key].count),
                                g: Math.floor(buckets[key].g / buckets[key].count),
                                b: Math.floor(buckets[key].b / buckets[key].count)
                            };
                        }
                    }

                    // Fallback to average of top-left if NO vibrant colors found (e.g. B&W photo)
                    if (highestCount === 0) {
                        dominantRGB = { r: data[0], g: data[1], b: data[2] };
                    }

                    // The massive background is handled by the blurred div behind the canvas.

                    // Make the glint and particles perfectly match the dominant color, but brighter
                    let accentR = Math.min(255, Math.floor(dominantRGB.r * 1.5 + 40));
                    let accentG = Math.min(255, Math.floor(dominantRGB.g * 1.5 + 40));
                    let accentB = Math.min(255, Math.floor(dominantRGB.b * 1.5 + 40));
                    currentAccentColor = `${accentR}, ${accentG}, ${accentB}`;
                };
            } else {
                // No thumbnail — show the Lyrical logo as a fallback
                albumArt.src = 'Images/Default.png';
                albumArt.style.display = 'block';
                miniAlbumArt.src = 'Images/Default.png';
                miniAlbumArt.style.display = 'block';
                document.getElementById('blurredBackground').style.backgroundImage = "url('Images/Default.png')";
                document.getElementById('sidebar').style.backgroundImage = "url('Images/Default.png')";
                currentAccentColor = '180, 255, 230'; // Default teal glint
            }

            // Zero delay precise synchronization
            currentPosition = data.position;
            currentDuration = data.duration || 0;
            if (data.lyrics === "Loading...") {
                parsedLyrics = [{ time: 0, text: "Fetching lyrics...", isHTML: false }];
            } else if (data.lyrics && typeof data.lyrics === 'string') {
                parsedLyrics = parseLRC(data.lyrics);
            } else {
                parsedLyrics = [];
            }
            renderLyrics();

            // Auto update selector if it's currently open
            if (!selectorOverlay.classList.contains('hidden')) {
                selectedLineIndices.clear();
                buildSelectorList();
            }
        } else {
            currentDuration = data.duration || currentDuration;
            if (Math.abs(data.position - currentPosition) > 0.3) {
                currentPosition = data.position;
            }

            // CHECK IF LYRICS ARRIVED (if they were loading previously)
            if (data.lyrics !== rawLyrics) {
                rawLyrics = data.lyrics;
                if (data.lyrics === "Loading...") {
                    parsedLyrics = [{ time: 0, text: "Fetching lyrics...", isHTML: false }];
                } else if (data.lyrics) {
                    parsedLyrics = parseLRC(data.lyrics);
                } else {
                    parsedLyrics = [];
                }
                renderLyrics();
            }
        }
    } catch (e) {
        console.error("Backend offline. Make sure you run 'python backend.py'.", e);
    }
}

let currentDuration = 0;

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Extrapolate position locally between polls for smoother scrolling
function tick() {
    if (isPlaying) {
        const now = Date.now();
        const diff = (now - lastPollTime) / 1000;
        lastPollTime = now;
        currentPosition += diff;
        updateLyricsDisplay();

        if (currentDuration > 0) {
            const pct = Math.min(100, (currentPosition / currentDuration) * 100);
            const progressBar = document.getElementById('progressBar');
            if (progressBar) {
                progressBar.style.width = pct + '%';
            }

            const timeCurrElem = document.getElementById('timeCurrent');
            if (timeCurrElem) timeCurrElem.innerText = formatTime(currentPosition);

            const timeTotalElem = document.getElementById('timeTotal');
            if (timeTotalElem) timeTotalElem.innerText = formatTime(currentDuration);
        }
    }
    requestAnimationFrame(tick);
}

setInterval(fetchCurrentSong, 1500); // Poll every 1.5 seconds
fetchCurrentSong(); // Initial call
requestAnimationFrame(tick); // Start local extrapolation loop

// ===== SHARE / LYRICS CARD FEATURE =====
let selectedLineIndices = new Set();

const shareBtn = document.getElementById('shareBtn');
const selectorOverlay = document.getElementById('selectorOverlay');
const selectorClose = document.getElementById('selectorClose');
const selectorList = document.getElementById('selectorList');
const selectorCount = document.getElementById('selectorCount');
const selectorContinue = document.getElementById('selectorContinue');
const cardModal = document.getElementById('cardModal');
const cardModalBackdrop = document.getElementById('cardModalBackdrop');
const cardBack = document.getElementById('cardBack');
const cardDownload = document.getElementById('cardDownload');

// ===== MEDIA CONTROLS =====
let localIsPlaying = null;
function updatePlayPauseIcons() {
    if (localIsPlaying === isPlaying) return;
    localIsPlaying = isPlaying;

    const pairs = [
        { play: document.getElementById('iconPlay'), pause: document.getElementById('iconPause') },
        { play: document.getElementById('miniIconPlay'), pause: document.getElementById('miniIconPause') }
    ];

    pairs.forEach(pair => {
        if (pair.play && pair.pause) {
            if (isPlaying) {
                pair.play.style.display = 'none';
                pair.pause.style.display = 'block';
            } else {
                pair.play.style.display = 'block';
                pair.pause.style.display = 'none';
            }
        }
    });
}

async function controlMedia(action) {
    try {
        await fetch(`/control/${action}`, { method: 'POST' });
        setTimeout(fetchCurrentSong, 300); // Quick poll to update UI fast
    } catch (e) {
        console.error("Media control failed", e);
    }
}

// --- SPACEBAR SHORTCUT: Play / Pause ---
document.addEventListener('keydown', (e) => {
    // Only trigger if not typing in an input field
    if (e.code === 'Space' && !e.target.matches('input, textarea, [contenteditable]')) {
        e.preventDefault();
        controlMedia(isPlaying ? 'pause' : 'play');
        isPlaying = !isPlaying;
        updatePlayPauseIcons();
    }
});

document.getElementById('btnPrev')?.addEventListener('click', () => controlMedia('prev'));
document.getElementById('btnNext')?.addEventListener('click', () => controlMedia('next'));
document.getElementById('btnPlayPause')?.addEventListener('click', () => {
    controlMedia(isPlaying ? 'pause' : 'play');
    isPlaying = !isPlaying;
    updatePlayPauseIcons();
});

document.getElementById('miniBtnPrev')?.addEventListener('click', () => controlMedia('prev'));
document.getElementById('miniBtnNext')?.addEventListener('click', () => controlMedia('next'));
document.getElementById('miniBtnPlayPause')?.addEventListener('click', () => {
    controlMedia(isPlaying ? 'pause' : 'play');
    isPlaying = !isPlaying;
    updatePlayPauseIcons();
});

// ===== SIDEBAR TOGGLE =====
const sidebar = document.getElementById('sidebar');
const topMiniPlayer = document.getElementById('topMiniPlayer');
const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
const sidebarExpandBtn = document.getElementById('sidebarExpandBtn');

sidebarCollapseBtn?.addEventListener('click', () => {
    sidebar.classList.add('collapsed');
    sidebarCollapseBtn.classList.add('hidden');
    topMiniPlayer.classList.remove('hidden');
});

sidebarExpandBtn?.addEventListener('click', () => {
    sidebar.classList.remove('collapsed');
    sidebarCollapseBtn.classList.remove('hidden');
    topMiniPlayer.classList.add('hidden');
});

// ===== SETTINGS MODAL =====
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsModalBackdrop = document.getElementById('settingsModalBackdrop');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');

settingsBtn?.addEventListener('click', () => settingsModal.classList.remove('hidden'));
settingsCloseBtn?.addEventListener('click', () => settingsModal.classList.add('hidden'));
settingsModalBackdrop?.addEventListener('click', () => settingsModal.classList.add('hidden'));

document.getElementById('lyricParticlesToggle')?.addEventListener('change', (e) => {
    lyricParticlesEnabled = e.target.checked;
    localStorage.setItem('lyricalSettings', JSON.stringify({ lyricParticlesEnabled, bgParticlesEnabled, appleLayoutEnabled }));
});

document.getElementById('bgParticlesToggle')?.addEventListener('change', (e) => {
    bgParticlesEnabled = e.target.checked;
    localStorage.setItem('lyricalSettings', JSON.stringify({ lyricParticlesEnabled, bgParticlesEnabled, appleLayoutEnabled }));
});

// Sync segmented toggle with current state on load
applyLayoutMode(appleLayoutEnabled);

document.getElementById('layoutSegmented')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented-option');
    if (!btn) return;
    applyLayoutMode(btn.dataset.layout === 'apple');
});


// Open the selector when the share button is clicked
shareBtn?.addEventListener('click', () => {
    if (parsedLyrics.length === 0) return;
    selectedLineIndices.clear();
    buildSelectorList();
    selectorOverlay.classList.remove('hidden');
});

// Close selector
selectorClose.addEventListener('click', () => {
    selectorOverlay.classList.add('hidden');
});

// Build the list of all lyric lines
function buildSelectorList() {
    selectorList.innerHTML = '';
    selectedLineIndices.clear();
    updateSelectorState();

    parsedLyrics.forEach((line, idx) => {
        const item = document.createElement('div');
        item.className = 'selector-lyric-item';
        item.textContent = line.text;
        item.dataset.idx = idx;
        item.id = `sel-item-${idx}`;
        item.addEventListener('click', () => {
            if (selectedLineIndices.has(idx)) {
                // Deselect: only allow removing from the edges of the consecutive range
                const sorted = [...selectedLineIndices].sort((a, b) => a - b);
                const minIdx = sorted[0];
                const maxIdx = sorted[sorted.length - 1];
                if (idx === minIdx || idx === maxIdx) {
                    selectedLineIndices.delete(idx);
                    item.classList.remove('selected');
                }
                // Ignore clicks on interior selected items
            } else {
                // Only allow selecting if it is adjacent to the current range (or first pick)
                if (selectedLineIndices.size === 0) {
                    selectedLineIndices.add(idx);
                    item.classList.add('selected');
                } else if (selectedLineIndices.size >= 4) {
                    // Max 4 lines — ignore
                } else {
                    const sorted = [...selectedLineIndices].sort((a, b) => a - b);
                    const minIdx = sorted[0];
                    const maxIdx = sorted[sorted.length - 1];
                    if (idx === minIdx - 1 || idx === maxIdx + 1) {
                        selectedLineIndices.add(idx);
                        item.classList.add('selected');
                    }
                    // Non-adjacent: ignore
                }
            }
            updateSelectorState();
        });
        selectorList.appendChild(item);
    });
}

function updateSelectorState() {
    const count = selectedLineIndices.size;
    selectorCount.textContent = count === 0 ? '0 lines selected' : `${count} line${count > 1 ? 's' : ''} selected`;
    selectorContinue.disabled = count === 0;

    // Gray out non-selectable items
    const sorted = [...selectedLineIndices].sort((a, b) => a - b);
    const minIdx = sorted[0];
    const maxIdx = sorted[sorted.length - 1];

    parsedLyrics.forEach((_, idx) => {
        const el = document.getElementById(`sel-item-${idx}`);
        if (!el) return;
        if (selectedLineIndices.has(idx)) {
            el.style.opacity = '1';
            el.style.pointerEvents = 'auto';
        } else if (count === 0 || count >= 4) {
            // count=0: all selectable, count=4: none selectable
            el.style.opacity = count >= 4 ? '0.25' : '1';
            el.style.pointerEvents = count >= 4 ? 'none' : 'auto';
        } else {
            // Only adjacent items are selectable
            const isAdjacent = idx === minIdx - 1 || idx === maxIdx + 1;
            el.style.opacity = isAdjacent ? '1' : '0.25';
            el.style.pointerEvents = isAdjacent ? 'auto' : 'none';
        }
    });
}

// Build the card preview
selectorContinue.addEventListener('click', async () => {
    selectorContinue.textContent = '...';
    await buildCard();
    selectorContinue.textContent = 'Continue';
    selectorOverlay.classList.add('hidden');
    cardModal.classList.remove('hidden');
});

function generateBlurredBackground(imgSrc) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 150; // Low resolution is perfectly fine for massive blurs
            canvas.height = 150;
            // Native canvas filter gets completely baked into the raw image pixels!
            ctx.filter = `blur(20px) brightness(0.5) saturate(2)`;
            // Draw image slightly out of bounds to avoid clear transparent borders
            ctx.drawImage(img, -20, -20, canvas.width + 40, canvas.height + 40);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => resolve(''); // Fallback
        img.src = imgSrc;
    });
}

async function buildCard() {
    // Sort selected lines by their original order
    const sortedIndices = [...selectedLineIndices].sort((a, b) => a - b);
    const lyricsText = sortedIndices.map(i => parsedLyrics[i].text).join('\n');

    // Fill in song info
    document.getElementById('cardSongTitle').textContent = document.getElementById('songTitle').innerText;
    document.getElementById('cardSongArtist').textContent = document.getElementById('songArtist').innerText;

    // Fill in lyrics, preserving line breaks
    const cardLyricsEl = document.getElementById('cardLyrics');
    cardLyricsEl.innerHTML = '';
    sortedIndices.forEach((idx) => {
        const line = document.createElement('div');
        line.textContent = parsedLyrics[idx].text;
        cardLyricsEl.appendChild(line);
    });

    // Adjust text sizing based on how many lines are selected
    const wantGlow = document.getElementById('glowToggle').checked;
    if (sortedIndices.length === 1) {
        cardLyricsEl.style.fontSize = '32px';
        cardLyricsEl.style.textShadow = wantGlow ? '0 0 30px rgba(255,255,255,0.5), 0 0 60px rgba(255,255,255,0.2)' : 'none';
    } else {
        cardLyricsEl.style.fontSize = '';
        cardLyricsEl.style.textShadow = wantGlow ? '0 0 20px rgba(255,255,255,0.35), 0 0 40px rgba(255,255,255,0.15)' : 'none';
    }

    // Clear out any old inline flex/alignment styles from previous version
    cardLyricsEl.style.display = '';
    cardLyricsEl.style.alignItems = '';
    cardLyricsEl.style.justifyContent = '';
    cardLyricsEl.style.textAlign = '';

    // Album art on the card
    const albumSrc = document.getElementById('albumArt').src;
    const cardArtEl = document.getElementById('cardAlbumArt');
    if (albumSrc && document.getElementById('albumArt').style.display !== 'none') {
        cardArtEl.src = albumSrc;
        cardArtEl.style.display = 'block';
        // Also set the card background blur (Bake it to canvas first to bypass html2canvas bug)
        const bakedBlurB64 = await generateBlurredBackground(albumSrc);
        document.getElementById('cardBgBlur').style.backgroundImage = bakedBlurB64 ? `url('${bakedBlurB64}')` : 'none';
        document.getElementById('cardBgBlur').style.filter = 'none'; // Clear any stray CSS
    } else {
        cardArtEl.style.display = 'none';
        document.getElementById('cardBgBlur').style.backgroundImage = 'none';
        document.getElementById('cardBgBlur').style.background = '#1c3d3a';
    }
}

// Back button returns to selector
cardBack.addEventListener('click', () => {
    cardModal.classList.add('hidden');
    selectorOverlay.classList.remove('hidden');
});

// Close modal on backdrop click
cardModalBackdrop.addEventListener('click', () => {
    cardModal.classList.add('hidden');
});

// Download the card as an image
cardDownload.addEventListener('click', async () => {
    const card = document.getElementById('lyricalCard');
    cardDownload.textContent = 'Saving...';

    try {
        const canvas = await html2canvas(card, {
            scale: 3,           // High DPI for crisp output
            useCORS: true,
            backgroundColor: null,
            logging: false
        });

        const b64_data = canvas.toDataURL('image/png');
        const title = document.getElementById('cardSongTitle').textContent.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filename = `lyrical_${title || 'card'}.png`;

        // Send image data to the Python backend which opens a native Save As dialog
        const response = await fetch('/save-card', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: b64_data, filename: filename })
        });
        const result = await response.json();
        if (!result.saved) {
            console.log('Save cancelled by user');
        }
    } catch (e) {
        console.error('Failed to save card:', e);
    }

    cardDownload.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Save Image`;
});

