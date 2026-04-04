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
        this.x += this.speedX;
        this.y += this.speedY;
        
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

function animateParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Spawn text particles if a word is actively highlighting
    if (activeKaraokeRect) {
        let px = activeKaraokeRect.left + (Math.random() * activeKaraokeRect.width);
        let py = activeKaraokeRect.top + (Math.random() * activeKaraokeRect.height);
        particlesArray.push(new Particle(true, px, py));
    }
    
    for (let i = particlesArray.length - 1; i >= 0; i--) {
        particlesArray[i].update();
        particlesArray[i].draw();
        
        if (particlesArray[i].isEmitter && particlesArray[i].opacity <= 0) {
            particlesArray.splice(i, 1);
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
    return result;
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
        // Render letter-by-letter to allow pixel-perfect smooth crawling
        const chars = line.text.split('');
        chars.forEach(char => {
            const span = document.createElement('span');
            span.className = 'lyric-letter';
            span.textContent = char;
            div.appendChild(span);
        });
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
    if (activeIndex !== -1 && lines[activeIndex]) {
        const activeElem = lines[activeIndex];
        const targetY = activeElem.offsetTop - (window.innerHeight / 2) + (activeElem.clientHeight / 2);
        container.style.transform = `translateY(-${targetY}px)`;
    } else {
        container.style.transform = `translateY(0px)`;
    }
    
    activeKaraokeRect = null; // reset global tracker
    
    // Update classes
    for (let i = 0; i < lines.length; i++) {
        lines[i].classList.remove('active', 'past');
        const letterSpans = lines[i].querySelectorAll('.lyric-letter');
        
        if (i === activeIndex) {
            lines[i].classList.add('active');
            
            // Calculate true time until next line
            let crawlDuration = 4.0;
            if (i + 1 < parsedLyrics.length) {
                crawlDuration = Math.max(0.1, parsedLyrics[i+1].time - parsedLyrics[i].time);
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
}

// Poll the backend
async function fetchCurrentSong() {
    try {
        const res = await fetch('http://127.0.0.1:5000/current');
        if (!res.ok) {
            document.getElementById('songTitle').innerText = "Not Playing";
            document.getElementById('songArtist').innerText = "Start music for lyrics...";
            return;
        }
        const data = await res.json();
        
        document.getElementById('songTitle').innerText = data.title;
        document.getElementById('songArtist').innerText = data.artist;
        
        isPlaying = data.is_playing;
        lastPollTime = Date.now();
        
        const songId = `${data.title}-${data.artist}`;
        if (songId !== currentSongId) {
            currentSongId = songId;
            
            const albumArt = document.getElementById('albumArt');
            if (data.thumbnail) {
                albumArt.src = data.thumbnail;
                albumArt.style.display = 'block';
                document.getElementById('blurredBackground').style.backgroundImage = `url('${data.thumbnail}')`;
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
                        let g = data[i+1];
                        let b = data[i+2];
                        let a = data[i+3];
                        
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
                albumArt.style.display = 'none';
                document.getElementById('blurredBackground').style.backgroundImage = 'none';
                currentAccentColor = '180, 255, 230'; // Default teal glint
            }
            
            // Zero delay precise synchronization
            currentPosition = data.position;
            if (data.lyrics && typeof data.lyrics === 'string') {
                parsedLyrics = parseLRC(data.lyrics);
            } else {
                parsedLyrics = [];
            }
            renderLyrics();
        } else {
            if (Math.abs(data.position - currentPosition) > 0.3) {
                currentPosition = data.position;
            }
        }
    } catch (e) {
        console.error("Backend offline. Make sure you run 'python backend.py'.", e);
    }
}

// Extrapolate position locally between polls for smoother scrolling
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

setInterval(fetchCurrentSong, 1500); // Poll every 1.5 seconds
fetchCurrentSong(); // Initial call
requestAnimationFrame(tick); // Start local extrapolation loop
