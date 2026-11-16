"""Starts the Image Engine on Google Colab: API key + public tunnel + server. Run from the notebook:  !python -u worker/image/colab_server.py
Set IPS_IMAGE_MODEL=klein (default, FLUX.2 klein 4B) or sdxl.  Tests without a GPU:  IPS_IMAGE_MOCK=1."""
import hmac, os, re, secrets, shutil, subprocess, sys, threading, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('IPS_IMAGE_DIR', '/content' if os.path.isdir('/content') else '/tmp')
import image_api
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

API_KEY = os.environ.get('IPS_API_KEY') or secrets.token_urlsafe(32)   # fresh key on every run
PORT = int(os.environ.get('PORT', '8000'))
app = FastAPI()
PUBLIC_URL = ''


@app.middleware('http')
async def guard(request: Request, call_next):
    if request.method == 'OPTIONS' or request.url.path.startswith('/files/'):
        return await call_next(request)
    if not hmac.compare_digest(request.headers.get('authorization', '').encode('utf-8', 'ignore'), f'Bearer {API_KEY}'.encode()):
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
        o = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,memory.used', '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=5).stdout.split(',')
        gpu, total, used = o[0].strip(), float(o[1]) / 1024, float(o[2]) / 1024
    except Exception: pass  # noqa: BLE001
    d = shutil.disk_usage('/')
    active = sum(1 for j in image_api.JOBS.values() if j['status'] in ('QUEUED', 'RUNNING'))
    name = 'FLUX.2 klein 4B' if image_api.MODEL == 'klein' else 'SDXL + IP-Adapter'
    return {'ok': True, 'gpu': gpu, 'vram_total_gb': None if total is None else round(total, 1), 'vram_used_gb': None if used is None else round(used, 1),
            'disk_total_gb': round(d.total / 1e9, 1), 'disk_used_gb': round(d.used / 1e9, 1), 'model': name + (' (mock)' if image_api.MOCK else ''), 'ready': True, 'active_tasks': active}


image_api.register(app, lambda: PUBLIC_URL)


def start_tunnel(port):
    exe = '/tmp/cloudflared'
    if not os.path.exists(exe):
        subprocess.run(['wget', '-q', '-O', exe, 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64'], check=True)
        os.chmod(exe, 0o755)
    proc = subprocess.Popen([exe, 'tunnel', '--url', f'http://127.0.0.1:{port}', '--no-autoupdate'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    found = {}
    def drain():
        for line in proc.stdout:
            m = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
            if m and 'url' not in found: found['url'] = m.group(0)
    threading.Thread(target=drain, daemon=True).start()
    for _ in range(90):
        if 'url' in found: return found['url']
        time.sleep(1)
    raise RuntimeError('Could not open the public tunnel.')


if __name__ == '__main__':
    import uvicorn
    threading.Thread(target=lambda: uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=PORT, log_level='warning')).run(), daemon=True).start()
    time.sleep(2)
    PUBLIC_URL = start_tunnel(PORT) if os.environ.get('IPS_NO_TUNNEL') != '1' else f'http://127.0.0.1:{PORT}'
    print('\n' + '=' * 64)
    print('  IMAGE API URL :', PUBLIC_URL)
    print('  API KEY       :', API_KEY)
    print('=' * 64)
    print('Copy both into IPS edit -> Command Center -> Image Engine -> Connect.')
    print('Keep this cell running. The model loads when the first batch starts (a few minutes the first time).\n')
    while True:
        time.sleep(300)
        print(time.strftime('%H:%M'), 'active jobs', sum(1 for j in image_api.JOBS.values() if j['status'] in ('QUEUED', 'RUNNING')))
