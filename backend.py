import asyncio
import datetime
import base64
import logging
import os
import sys
import threading
import time
import webbrowser
import json
import re
import urllib.parse

from flask import Flask, jsonify, request as flask_request
from flask_cors import CORS
import requests
from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager
from winsdk.windows.storage.streams import Buffer

# When packaged as an EXE by PyInstaller, files are extracted to sys._MEIPASS.
# When running normally as a .py, they live next to the script.
def resource_path(relative):
    base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative)

app = Flask(__name__, static_folder=resource_path('web'), static_url_path='')
# Restrict CORS to localhost only — this app should never be accessible from external origins
CORS(app, origins=['http://127.0.0.1:5000', 'http://localhost:5000'])
logging.basicConfig(level=logging.INFO)

# --- Persistent Cache Configuration ---
CACHE_FILE = os.path.join(os.path.expanduser("~"), ".lyrical_cache.json")

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_cache(cache):
    try:
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

lyrics_db = load_cache()

# Global state to cache lyrics to avoid spamming the API
current_song_state = {
    "title": "",
    "artist": "",
    "album": "",
    "lyrics": None,
    "position": 0.0,
    "duration": 0.0,
    "is_playing": False,
    "thumbnail": "",
    "last_fetch_time": 0
}

# --- Persistent event loop for WinSDK COM calls ---
# WinSDK COM objects are apartment-threaded. We must create ONE asyncio loop
# on ONE dedicated thread, and always call into it from everywhere else.
_media_loop = asyncio.new_event_loop()

def _run_media_loop():
    asyncio.set_event_loop(_media_loop)
    _media_loop.run_forever()

threading.Thread(target=_run_media_loop, daemon=True).start()

def run_on_media_loop(coro, timeout=5):
    """Safely submit an async coroutine to the persistent media loop and wait for its result."""
    future = asyncio.run_coroutine_threadsafe(coro, _media_loop)
    try:
        return future.result(timeout=timeout)
    except Exception as e:
        logging.error(f"Media loop call failed: {e}")
        return None

async def get_media_info():
    try:
        manager = await GlobalSystemMediaTransportControlsSessionManager.request_async()
        session = manager.get_current_session()
        
        if not session:
            return None
            
        media_properties = await session.try_get_media_properties_async()
        timeline = session.get_timeline_properties()
        playback_info = session.get_playback_info()
        
        if media_properties:
            title = media_properties.title
            artist = media_properties.artist
            album = media_properties.album_title
            
            thumbnail_b64 = ""
            if media_properties.thumbnail:
                try:
                    stream = await media_properties.thumbnail.open_read_async()
                    buf = Buffer(stream.size)
                    await stream.read_async(buf, buf.capacity, 0)
                    thumbnail_b64 = "data:image/png;base64," + base64.b64encode(bytes(buf)).decode('utf-8')
                except Exception:
                    pass
            
            # Position is a datetime.timedelta object in winsdk python bindings
            position = timeline.position.total_seconds() if timeline.position else 0.0
            duration = timeline.end_time.total_seconds() if timeline.end_time else 0.0
            
            # playback_status enum: 4 is Playing, 5 is Paused
            is_playing = (playback_info.playback_status == 4) if playback_info else False
            
            if timeline.last_updated_time and is_playing:
                now = datetime.datetime.now(datetime.timezone.utc)
                diff = (now - timeline.last_updated_time).total_seconds()
                if diff > 0:
                    position += diff
            
            return {
                "title": title,
                "artist": artist,
                "album": album,
                "position": position,
                "duration": duration,
                "is_playing": is_playing,
                "thumbnail": thumbnail_b64
            }
    except Exception as e:
        logging.error(f"Error getting media info: {e}")
    return None

async def control_media(action):
    try:
        manager = await GlobalSystemMediaTransportControlsSessionManager.request_async()
        session = manager.get_current_session()
        if not session:
            return False
            
        if action == 'play':
            await session.try_play_async()
        elif action == 'pause':
            await session.try_pause_async()
        elif action == 'next':
            await session.try_skip_next_async()
        elif action == 'prev':
            await session.try_skip_previous_async()
        return True
    except Exception as e:
        logging.error(f"Error controlling media: {e}")
        return False

def _normalize(s):
    """Lowercase and strip punctuation for fuzzy comparison."""
    return re.sub(r'[^\w\s]', '', s.lower()).strip()

def _best_result(results, track_name, artist_name):
    """Pick the best match from a list of lrclib results.
    Priority: has syncedLyrics > title match > artist match.
    Synced is weighted so heavily that it wins over plain even with a loose artist match."""
    norm_title = _normalize(track_name)
    norm_artist = _normalize(artist_name)

    def score(r):
        r_title = _normalize(r.get("trackName", ""))
        r_artist = _normalize(r.get("artistName", ""))
        has_synced = bool(r.get("syncedLyrics"))
        title_exact = r_title == norm_title
        # Partial artist match: handles "Ben&Ben" vs "Ben" or split names
        artist_exact = r_artist == norm_artist
        artist_partial = norm_artist in r_artist or r_artist in norm_artist
        return (has_synced * 8) + (title_exact * 4) + (artist_exact * 2) + (artist_partial * 1)

    results_with_lyrics = [r for r in results if r.get("syncedLyrics") or r.get("plainLyrics")]
    if not results_with_lyrics:
        return None
    return max(results_with_lyrics, key=score)

def fetch_lyrics(track_name, artist_name, album_name):
    # Check persistent cache first
    cache_key = f"{track_name.strip()}-{artist_name.strip()}".lower()
    if cache_key in lyrics_db:
        logging.info(f"Loaded lyrics from persistent cache: {track_name}")
        return lyrics_db[cache_key]

    # Using lrclib.net because it's free and doesn't require API keys
    try:
        # --- Attempt 1: structured /api/get (exact lookup) ---
        params = {
            "track_name": track_name.strip(),
            "artist_name": artist_name.strip(),
        }
        if album_name and album_name.strip():
            params["album_name"] = album_name.strip()

        response = requests.get("https://lrclib.net/api/get", params=params, timeout=10)
        plain_fallback = None
        if response.status_code == 200:
            data = response.json()
            if data.get("syncedLyrics"):
                lyrics = data["syncedLyrics"]
                lyrics_db[cache_key] = lyrics
                save_cache(lyrics_db)
                return lyrics
            # Has only plain lyrics — save as fallback but keep trying for synced
            plain_fallback = data.get("plainLyrics")

        # --- Attempt 2: structured /api/search with track+artist fields ---
        search_params = {
            "track_name": track_name.strip(),
            "artist_name": artist_name.strip(),
        }
        search_res = requests.get("https://lrclib.net/api/search", params=search_params, timeout=10)
        if search_res.status_code == 200:
            results = search_res.json()
            best = _best_result(results, track_name, artist_name)
            if best:
                lyrics = best.get("syncedLyrics") or best.get("plainLyrics")
                if lyrics:
                    lyrics_db[cache_key] = lyrics
                    save_cache(lyrics_db)
                return lyrics

        # --- Attempt 3: freetext /api/search as last resort ---
        q_url = f"https://lrclib.net/api/search?q={urllib.parse.quote(track_name.strip() + ' ' + artist_name.strip())}"
        q_res = requests.get(q_url, timeout=10)
        if q_res.status_code == 200:
            results = q_res.json()
            best = _best_result(results, track_name, artist_name)
            if best:
                lyrics = best.get("syncedLyrics") or best.get("plainLyrics")
                if lyrics:
                    lyrics_db[cache_key] = lyrics
                    save_cache(lyrics_db)
                return lyrics

        # --- Final fallback: plain lyrics from Attempt 1 if nothing synced found ---
        if plain_fallback:
            lyrics_db[cache_key] = plain_fallback
            save_cache(lyrics_db)
            return plain_fallback

    except Exception as e:
        logging.error(f"Failed to fetch lyrics: {e}")
    return None

def update_state(media_info):
    global current_song_state
    
    song_changed = (media_info['title'] != current_song_state['title'] or media_info['artist'] != current_song_state['artist'])
    
    # Retry if song changed OR if we have no lyrics and haven't tried in the last 15 seconds
    # None = not yet fetched, "" = fetched but nothing found (stop retrying)
    should_fetch = song_changed or (
        current_song_state['lyrics'] is None and 
        (time.time() - current_song_state['last_fetch_time'] > 15)
    )

    if should_fetch:
        if song_changed:
            logging.info(f"New song detected: {media_info['title']} by {media_info['artist']}")
            current_song_state['title'] = media_info['title']
            current_song_state['artist'] = media_info['artist']
            current_song_state['album'] = media_info['album']
            current_song_state['lyrics'] = "Loading..." # Show loading state
        else:
            logging.info(f"Retrying lyrics fetch for: {media_info['title']}")
            
        current_song_state['last_fetch_time'] = time.time()
        
        # Fetch in background to prevent UI lag
        def fetch_bg(t, a, alb):
            logging.info(f"Background fetch started for: {t}")
            lyrics = fetch_lyrics(t, a, alb)
            # Only update if the song hasn't changed while we were fetching
            if current_song_state['title'] == t and current_song_state['artist'] == a:
                if lyrics:
                    current_song_state['lyrics'] = lyrics
                    logging.info(f"Successfully fetched lyrics for: {t}")
                else:
                    current_song_state['lyrics'] = ""  # Sentinel: tried, nothing found — stop retrying
                    logging.info(f"No lyrics found for: {t}, stopping retries")

        threading.Thread(target=fetch_bg, args=(media_info['title'], media_info['artist'], media_info['album']), daemon=True).start()
        
    current_song_state['position'] = media_info['position']
    current_song_state['duration'] = media_info['duration']
    current_song_state['is_playing'] = media_info['is_playing']
    current_song_state['thumbnail'] = media_info.get('thumbnail', '')

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/current')
def current_track():
    # Submit the async COM call to our persistent event loop thread
    media_info = run_on_media_loop(get_media_info())
    
    if media_info:
        update_state(media_info)
        return jsonify(current_song_state)
    else:
        return jsonify({"error": "No media currently playing"}), 404

@app.route('/control/<action>', methods=['POST'])
def control_action(action):
    if action not in ['play', 'pause', 'next', 'prev']:
        return jsonify({"error": "Invalid action"}), 400
        
    success = run_on_media_loop(control_media(action))
    if success:
        return jsonify({"success": True})
    else:
        return jsonify({"error": "Failed to control media"}), 500

@app.route('/save-card', methods=['POST'])
def save_card():
    """Save a lyric card image via a native Windows Save As dialog (tkinter)."""
    data = flask_request.get_json()
    b64_data = data.get('image', '')
    filename = data.get('filename', 'lyrical_card.png')
    
    if ',' in b64_data:
        b64_data = b64_data.split(',')[1]
    
    result = {'saved': False}
    
    def do_save():
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()  # Hide the root window
        root.attributes('-topmost', True)  # Make sure dialog appears on top
        
        save_path = filedialog.asksaveasfilename(
            defaultextension='.png',
            filetypes=[('PNG Image', '*.png'), ('All files', '*.*')],
            initialfile=filename
        )
        
        root.destroy()
        
        if save_path:
            try:
                with open(save_path, 'wb') as f:
                    f.write(base64.b64decode(b64_data))
                result['saved'] = True
            except Exception as e:
                logging.error(f"Failed to write image: {e}")
    
    # tkinter must run on its own thread to avoid blocking Flask
    save_thread = threading.Thread(target=do_save)
    save_thread.start()
    save_thread.join(timeout=60)  # Wait up to 60 seconds for user to pick a location
    
    return jsonify(result)

if __name__ == '__main__':
    import webview
    
    def start_server():
        app.run(port=5000, debug=False, use_reloader=False)
        
    print("Starting Lyrics Backend Engine...")
    
    # Start the local server
    threading.Thread(target=start_server, daemon=True).start()
    
    # Create the native desktop application window (NO js_api — avoids COM bridge crashes)
    window = webview.create_window(
        'Lyrical', 
        'http://127.0.0.1:5000',
        width=1000, 
        height=720,
        min_size=(850, 600), # Prevents UI from breaking on small screens
        background_color='#0d1b1a'
    )
    
    webview.start()

