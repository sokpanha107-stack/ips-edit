"""Shared by the Python functions: only a signed-in user may call them. The token is verified by Supabase Auth itself."""
import json
import os
import urllib.request


def verify(headers):
    """Returns the Supabase user dict, or None. Uses only the public Supabase URL + anon key (no secrets)."""
    auth = headers.get("Authorization", "")
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    anon = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    if not auth.lower().startswith("bearer ") or not url or not anon:
        return None
    req = urllib.request.Request(f"{url}/auth/v1/user", headers={"Authorization": auth, "apikey": anon})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            user = json.loads(r.read())
            return user if user.get("id") else None
    except Exception:
        return None


def read_json(handler, limit=60_000):
    n = int(handler.headers.get("Content-Length") or 0)
    if n <= 0 or n > limit:
        raise ValueError("body missing or too large")
    return json.loads(handler.rfile.read(n))


def send_json(handler, status, obj):
    data = json.dumps(obj, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)
