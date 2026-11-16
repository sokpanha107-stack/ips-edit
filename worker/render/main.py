"""Standalone render server:  pip install -r requirements.txt  &&  RENDER_KEY=secret uvicorn main:app --host 0.0.0.0 --port 8000
Needs ffmpeg on the machine. Same API as the Colab server (/render, /render/status/{id}, /files/render/{name})."""
import hmac, os
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import render_api

KEY = os.environ.get('RENDER_KEY', '')
app = FastAPI()


@app.middleware('http')
async def guard(request: Request, call_next):
    if KEY and request.method != 'OPTIONS' and not request.url.path.startswith('/files/') and request.url.path != '/health':
        sent = request.headers.get('authorization', '').encode('utf-8', 'ignore')
        if not hmac.compare_digest(sent, f'Bearer {KEY}'.encode()):
            return JSONResponse({'error': 'unauthorized'}, status_code=401)
    return await call_next(request)


@app.get('/health')
def health():
    return {'ok': True}


render_api.register(app)
