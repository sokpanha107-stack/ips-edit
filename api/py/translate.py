"""POST /api/py/translate  {text, from, to}  ->  {ok, text}   (free: deep-translator, no API key)."""
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(__file__))
from _auth import read_json, send_json, verify  # noqa: E402

CODES = {"km", "en"}


def chunks(text, limit=4500):
    out, cur = [], ""
    for line in text.split("\n"):
        if len(cur) + len(line) + 1 > limit and cur:
            out.append(cur)
            cur = ""
        cur += line + "\n"
    if cur:
        out.append(cur)
    return out


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not verify(self.headers):
            return send_json(self, 401, {"ok": False, "error": "unauthorized"})
        try:
            body = read_json(self, 120_000)
            text, src, dst = str(body.get("text", "")), body.get("from"), body.get("to")
            if not text.strip() or src not in CODES or dst not in CODES:
                raise ValueError("text and from/to (km|en) are required")
            from deep_translator import GoogleTranslator
            tr = GoogleTranslator(source=src, target=dst)
            result = "\n".join(tr.translate(c.rstrip("\n")) or "" for c in chunks(text))
            return send_json(self, 200, {"ok": True, "text": result})
        except ValueError as e:
            return send_json(self, 400, {"ok": False, "error": str(e)})
        except Exception as e:
            return send_json(self, 502, {"ok": False, "error": f"translate failed: {e}"[:300]})
