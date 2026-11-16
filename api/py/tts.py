"""POST /api/py/tts  {text, lang}  ->  audio/mpeg   (free: gTTS, no API key)."""
import io
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(__file__))
from _auth import read_json, send_json, verify  # noqa: E402

LANGS = {"km", "en", "th", "vi", "zh-CN", "ja", "ko", "fr", "es", "de"}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not verify(self.headers):
            return send_json(self, 401, {"error": "unauthorized"})
        try:
            body = read_json(self)
            text = str(body.get("text", "")).strip()
            lang = str(body.get("lang", "en"))
            if not text or len(text) > 5000 or lang not in LANGS:
                raise ValueError("text (1-5000 chars) and a supported lang are required")
            from gtts import gTTS
            buf = io.BytesIO()
            gTTS(text=text, lang=lang).write_to_fp(buf)
            data = buf.getvalue()
        except ValueError as e:
            return send_json(self, 400, {"error": str(e)})
        except Exception as e:  # gTTS needs internet access to Google; report cleanly
            return send_json(self, 502, {"error": f"gTTS failed: {e}"[:300]})
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
