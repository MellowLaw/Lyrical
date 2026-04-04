import asyncio
import datetime
import base64
import logging
import os
import sys
import threading
import time
import webbrowser
import urllib.parse
from flask import Flask, jsonify
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

# Global state to cache lyrics to avoid spamming the API
current_song_state = {
    "title": "",
    "artist": "",
    "album": "",
    "lyrics": None,
    "position": 0.0,
    "duration": 0.0,
    "is_playing": False,
    "thumbnail": ""
}

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
            
            import datetime
            import base64
            
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

def fetch_lyrics(track_name, artist_name, album_name):
    # Using lrclib.net because it's free and doesn't require API keys
    try:
        url = f"https://lrclib.net/api/get?track_name={urllib.parse.quote(track_name.strip())}&artist_name={urllib.parse.quote(artist_name.strip())}"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            return data.get("syncedLyrics") or data.get("plainLyrics")
    except Exception as e:
        logging.error(f"Failed to fetch lyrics: {e}")
    return None

def update_state(media_info):
    global current_song_state
    
    # If the song has changed, fetch new lyrics
    if media_info['title'] != current_song_state['title'] or media_info['artist'] != current_song_state['artist']:
        logging.info(f"New song detected: {media_info['title']} by {media_info['artist']}")
        current_song_state['title'] = media_info['title']
        current_song_state['artist'] = media_info['artist']
        current_song_state['album'] = media_info['album']
        
        lyrics = fetch_lyrics(media_info['title'], media_info['artist'], media_info['album'])
        current_song_state['lyrics'] = lyrics
        
    current_song_state['position'] = media_info['position']
    current_song_state['duration'] = media_info['duration']
    current_song_state['is_playing'] = media_info['is_playing']
    current_song_state['thumbnail'] = media_info.get('thumbnail', '')


@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/current')
def current_track():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    media_info = loop.run_until_complete(get_media_info())
    loop.close()
    
    if media_info:
        update_state(media_info)
        return jsonify(current_song_state)
    else:
        return jsonify({"error": "No media currently playing"}), 404

if __name__ == '__main__':
    import webview
    
    def start_server():
        # Run Flask in a background thread so the main thread can be used by pywebview's UI loop
        app.run(port=5000, debug=False, use_reloader=False)
        
    print("Starting Lyrics Backend Engine...")
    
    # Start the local server
    threading.Thread(target=start_server, daemon=True).start()
    
    # Create the native desktop application window
    window = webview.create_window(
        'Lyrical', 
        'http://127.0.0.1:5000',
        width=1000, 
        height=700,
        background_color='#0d1b1a'  # Matches the default dark theme
    )
    webview.start()
