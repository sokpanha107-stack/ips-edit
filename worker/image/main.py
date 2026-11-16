"""Standalone Image Engine server:  pip install -r requirements.txt && IMAGE_KEY=secret uvicorn main:app --host 0.0.0.0 --port 8000
(IPS_IMAGE_MOCK=1 = placeholder pictures, no GPU needed.)   Same hardware/ping contract as the Video Engine so the Command Center monitor works."""
import hmac, os, shutil, subprocess
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import image_api

KEY = os.environ.get('IMAGE_KEY', '')
app = FastAPI()


@app.middleware('http')
async def guard(request: Request, call_next):
    if KEY and request.method != 'OPTIONS' and not request.url.path.startswith('/files/'):
        sent = request.headers.get('authorization', '').encode('utf-8', 'ignore')
        if not hmac.compare_digest(sent, f'Bearer {KEY}'.encode()):
            return JSONResponse({'error': 'unauthorized'}, status_code=401)
    return await call_next(request)


@app.get('/ping')
@app.get('/health')
def ping():
    return {'ok': True}


@app.get('/hardware')
def hardware():
    gpu, total, used = 'CPU', None, None
    try:
        out = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,memory.used', '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=5).stdout.split(',')
        gpu, total, used = out[0].strip(), float(out[1]) / 1024, float(out[2]) / 1024
    except Exception: pass  # noqa: BLE001
    d = shutil.disk_usage('/')
    active = sum(1 for j in image_api.JOBS.values() if j['status'] in ('QUEUED', 'RUNNING'))
    return {'ok': True, 'gpu': gpu, 'vram_total_gb': None if total is None else round(total, 1), 'vram_used_gb': None if used is None else round(used, 1),
            'disk_total_gb': round(d.total / 1e9, 1), 'disk_used_gb': round(d.used / 1e9, 1), 'model': 'SDXL + IP-Adapter' + (' (mock)' if image_api.MOCK else ''), 'ready': True, 'active_tasks': active}


image_api.register(app)
