"""Tiny FastAPI translation service (free, uses deep-translator).
Run:  pip install -r requirements.txt && TRANSLATE_KEY=secret uvicorn main:app --host 0.0.0.0 --port 8000
Contract: POST /translate {"text": "...", "from": "km"|"en", "to": "km"|"en"}  ->  {"ok": true, "text": "..."}
If TRANSLATE_KEY is set, send it as  Authorization: Bearer <key>.   GET /health -> {"ok": true}
"""
import hmac, os
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from translate_core import translate_text

KEY = os.environ.get('TRANSLATE_KEY', '')
app = FastAPI()


@app.middleware('http')
async def guard(request: Request, call_next):
    if KEY and request.url.path != '/health':
        sent = request.headers.get('authorization', '').encode('utf-8', 'ignore')
        if not hmac.compare_digest(sent, f'Bearer {KEY}'.encode()):
            return JSONResponse({'ok': False, 'error': 'unauthorized'}, status_code=401)
    return await call_next(request)


@app.get('/health')
def health():
    return {'ok': True}


@app.post('/translate')
async def translate(request: Request):
    body = await request.json()
    text, src, dst = str(body.get('text', '')), body.get('from'), body.get('to')
    if not text.strip() or src not in ('km', 'en') or dst not in ('km', 'en'):
        return JSONResponse({'ok': False, 'error': 'invalid request'}, status_code=400)
    try:
        return {'ok': True, 'text': translate_text(text[:6000], src, dst)}
    except Exception as e:  # noqa: BLE001
        return JSONResponse({'ok': False, 'error': str(e)[:160]}, status_code=502)
