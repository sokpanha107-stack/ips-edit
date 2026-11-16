# ===== Cell 2: IPS GPU API server (Wan2.2 TI2V-5B). Hardware-agnostic: T4 / L4 / A100. =====
# Prints an API URL + API KEY. Put both in IPS edit -> Command Center -> Video Engine -> Connect.
import asyncio, base64, hmac, io, json, math, os, queue, re, secrets, shutil, subprocess, sys, threading, time, traceback, uuid

TEST = os.environ.get('IPS_TEST') == '1'     # used only for offline testing of the API layer
FPS = 24
MAX_SECONDS = 5.0      # Wan2.2-5B is made for ~5 s (121 frames). Raise (e.g. 10) only if you have an A100 and have tested it.
PORT = 8000
OUT_DIR = '/content/ips_out'
DRIVE_OUT = '/content/drive/MyDrive/IPS_Outputs'
NEGATIVE = 'blurry, low quality, distorted face, deformed hands, extra fingers, jitter, flicker, watermark, subtitles'

if not TEST:
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '-U', 'deep-translator', 'diffusers', 'transformers', 'accelerate', 'sentencepiece',
                    'ftfy', 'imageio', 'imageio-ffmpeg', 'fastapi', 'uvicorn', 'python-multipart', 'requests', 'pillow'], check=True)
    from google.colab import drive
    drive.mount('/content/drive')

import requests
from PIL import Image
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

os.makedirs(OUT_DIR, exist_ok=True)
API_KEY = os.environ.get('IPS_API_KEY') or secrets.token_urlsafe(32)   # fresh key on every run
PUBLIC_URL = ''

def secret(name):
    try:
        from google.colab import userdata
        return userdata.get(name) or ''
    except Exception:
        return os.environ.get(name, '')

# ---------------------------------------------------------------- model
MODEL_DIRS = ['/content/drive/MyDrive/IPS_Models/Wan2.2-TI2V-5B-Diffusers', '/content/IPS_Models/Wan2.2-TI2V-5B-Diffusers']

def frames_for(seconds):
    """audio seconds x FPS, snapped to Wan's 4n+1 frame rule, capped by MAX_SECONDS."""
    cap = int(round(MAX_SECONDS * FPS / 4)) * 4 + 1
    n = int(round(seconds * FPS / 4)) * 4 + 1
    return max(17, min(n, cap))

class Engine:
    def __init__(self):
        self.pipe = None; self.error = None; self.tier = 'loading'; self.area = 1280 * 704; self.dtype = None; self.gpu = 'unknown'; self.vram_total = 0.0

    def load(self):
        if TEST:
            self.tier = 'test'; self.gpu = 'TEST GPU'; self.vram_total = 24.0; self.pipe = object(); return
        import torch
        from diffusers import AutoencoderKLWan, WanImageToVideoPipeline
        path = next((p for p in MODEL_DIRS if os.path.exists(os.path.join(p, '.ips_complete'))), None)
        if not path:
            raise RuntimeError('Model not found. Run Cell 1 first.')
        props = torch.cuda.get_device_properties(0)
        self.gpu = props.name; self.vram_total = props.total_memory / 1e9
        # bf16 needs compute capability 8+ (A100/L4). T4 falls back to fp16 (can be less stable).
        self.dtype = torch.bfloat16 if props.major >= 8 else torch.float16
        vae = AutoencoderKLWan.from_pretrained(path, subfolder='vae', torch_dtype=torch.float32)
        pipe = WanImageToVideoPipeline.from_pretrained(path, vae=vae, torch_dtype=self.dtype)
        if self.vram_total >= 38:            # A100 40/80 GB: everything in VRAM = fastest
            pipe.to('cuda'); self.tier = 'full-vram'; self.area = 1280 * 704
        elif self.vram_total >= 22:          # L4 / A10 24 GB
            pipe.enable_model_cpu_offload(); self.tier = 'cpu-offload'; self.area = 1280 * 704
        else:                                # T4 ~16 GB: save memory, smaller picture
            pipe.enable_model_cpu_offload(); self.tier = 'low-vram'; self.area = 832 * 480
            for fn in ('enable_tiling', 'enable_slicing'):
                try: getattr(pipe.vae, fn)()
                except Exception: pass
        self.pipe = pipe
        print(f'Model loaded on {self.gpu} ({self.vram_total:.0f} GB) mode={self.tier} dtype={self.dtype}')

    def generate(self, image, prompt, seconds, steps, guidance, seed, resolution, out_path):
        frames = frames_for(seconds)
        if TEST:
            open(out_path, 'wb').write(b'fake-mp4'); return {'frames': frames, 'width': 0, 'height': 0}
        import torch, numpy as np
        from diffusers.utils import export_to_video
        area = {'720p': 1280 * 704, '480p': 832 * 480}.get(resolution, self.area)
        for attempt in (1, 2):
            try:
                mod = self.pipe.vae_scale_factor_spatial * self.pipe.transformer.config.patch_size[1]
                ar = image.width / image.height
                w = round(math.sqrt(area * ar)) // mod * mod
                h = round(math.sqrt(area / ar)) // mod * mod
                img = image.resize((w, h))
                gen = torch.Generator(device='cuda').manual_seed(seed)
                with torch.no_grad(), torch.autocast('cuda', dtype=self.dtype):
                    video = self.pipe(image=img, prompt=prompt, negative_prompt=NEGATIVE, height=h, width=w, num_frames=frames,
                                      guidance_scale=guidance, num_inference_steps=steps, generator=gen).frames[0]
                export_to_video(video, out_path, fps=FPS)
                return {'frames': frames, 'width': w, 'height': h}
            except torch.cuda.OutOfMemoryError:
                import gc; gc.collect(); torch.cuda.empty_cache()
                if attempt == 2 or area <= 832 * 480:
                    raise RuntimeError('GPU out of memory even at 480p. Use a bigger GPU (A100/L4).')
                print('OOM: retrying at 480p'); area = 832 * 480

ENGINE = Engine()

# ---------------------------------------------------------------- jobs
JOBS, QUEUE = {}, queue.Queue()

def load_image(src):
    if src.startswith('data:'):
        data = base64.b64decode(src.split(',', 1)[1])
    else:
        r = requests.get(src, timeout=60); r.raise_for_status(); data = r.content
    return Image.open(io.BytesIO(data)).convert('RGB')

def publish(path, jid):
    """Copy to Drive as a backup; upload to Supabase Storage if its secrets are set (permanent URL); else serve from this server."""
    try:
        if os.path.isdir('/content/drive/MyDrive'):
            os.makedirs(DRIVE_OUT, exist_ok=True); shutil.copy(path, f'{DRIVE_OUT}/{jid}.mp4')
    except Exception as e:
        print('Drive backup failed:', e)
    base, key, bucket = secret('SUPABASE_URL').rstrip('/'), secret('SUPABASE_SERVICE_ROLE_KEY'), secret('SUPABASE_BUCKET') or 'ips-videos'
    if base and key:
        with open(path, 'rb') as f:
            r = requests.post(f'{base}/storage/v1/object/{bucket}/{jid}.mp4', data=f, timeout=600,
                              headers={'Authorization': f'Bearer {key}', 'Content-Type': 'video/mp4', 'x-upsert': 'true'})
        if r.ok:
            return f'{base}/storage/v1/object/public/{bucket}/{jid}.mp4'
        print('Supabase upload failed:', r.status_code, r.text[:150])
    return f'{PUBLIC_URL}/files/{jid}.mp4'

def run_job(jid, p):
    job = JOBS[jid]; job['status'] = 'IN_PROGRESS'
    try:
        out = f'{OUT_DIR}/{jid}.mp4'
        info = ENGINE.generate(load_image(p['image']), p['prompt'], p['seconds'], p['steps'], p['guidance'], p['seed'], p['resolution'], out)
        info.update(seconds_requested=p['seconds'], seconds_rendered=round(info['frames'] / FPS, 2))
        job.update(status='COMPLETED', output={'url': publish(out, jid), **info})
    except Exception as e:
        traceback.print_exc(); job.update(status='FAILED', error=str(e)[:300])
    if p.get('webhook'):
        try: requests.post(p['webhook'], json={'status': job['status'], 'output': job.get('output'), 'error': job.get('error')}, timeout=15)
        except Exception: pass

def worker_loop():
    try: ENGINE.load()
    except Exception as e:
        traceback.print_exc(); ENGINE.error = str(e)[:300]; ENGINE.tier = 'error'
    while True:
        jid, p = QUEUE.get()
        if ENGINE.error:
            JOBS[jid].update(status='FAILED', error=f'Model not ready: {ENGINE.error}')
        else:
            run_job(jid, p)
        QUEUE.task_done()

def start_worker(): threading.Thread(target=worker_loop, daemon=True).start()

def parse(body):
    inp = body.get('input') if isinstance(body.get('input'), dict) else body
    opts = inp.get('options') if isinstance(inp.get('options'), dict) else {}
    seconds = float(opts.get('audio_seconds') or inp.get('audio_duration') or inp.get('audio_seconds') or MAX_SECONDS)
    if not inp.get('image'): raise ValueError('image is required')
    return {'image': inp['image'], 'prompt': (inp.get('prompt') or 'gentle natural motion, subtle breathing and blinking').strip(),
            'seconds': max(0.5, min(seconds, 600)), 'steps': int(opts.get('steps') or 30), 'guidance': float(opts.get('guidance') or 5.0),
            'seed': int(opts['seed']) if opts.get('seed') is not None else secrets.randbelow(2**31),
            'resolution': str(opts.get('resolution') or ''), 'webhook': body.get('webhook')}

def enqueue(body):
    p = parse(body)
    jid = secrets.token_urlsafe(12)
    JOBS[jid] = {'status': 'IN_QUEUE', 'created': time.time()}
    for old in sorted(JOBS, key=lambda k: JOBS[k]['created'])[:-200]: JOBS.pop(old, None)
    QUEUE.put((jid, p)); return jid

# ---------------------------------------------------------------- API
app = FastAPI()

@app.middleware('http')
async def guard(request, call_next):
    if request.method == 'OPTIONS' or request.url.path.startswith('/files/'):   # file links carry an unguessable id (browsers cannot send headers)
        return await call_next(request)
    sent = request.headers.get('authorization', '').encode('utf-8', 'ignore')
    if not hmac.compare_digest(sent, f'Bearer {API_KEY}'.encode()):
        return JSONResponse({'error': 'unauthorized'}, status_code=401)
    return await call_next(request)

def hardware():
    vram_used = None
    total = ENGINE.vram_total
    if not TEST:
        try:
            import torch
            free, tot = torch.cuda.mem_get_info(); total = tot / 1e9; vram_used = (tot - free) / 1e9
        except Exception: pass
    disk = shutil.disk_usage('/content' if os.path.isdir('/content') else '/')
    active = QUEUE.qsize() + sum(1 for j in JOBS.values() if j['status'] == 'IN_PROGRESS')
    return {'ok': True, 'gpu': ENGINE.gpu, 'vram_total_gb': round(total, 1), 'vram_used_gb': None if vram_used is None else round(vram_used, 1),
            'disk_total_gb': round(disk.total / 1e9, 1), 'disk_used_gb': round(disk.used / 1e9, 1),
            'model': 'Wan2.2-TI2V-5B' + ('' if ENGINE.pipe else ' (loading…)'), 'mode': ENGINE.tier, 'ready': bool(ENGINE.pipe) and not ENGINE.error,
            'error': ENGINE.error, 'active_tasks': active}

# ---- free Khmer <-> English translation (deep-translator, no key) ----
import re as _re

LANG = {'km': 'km', 'en': 'en'}
MAX_CHARS = 4500   # the free web endpoint accepts ~5000 characters per request


def _pieces(line: str):
    if len(line) <= MAX_CHARS:
        return [line]
    out, cur = [], ''
    for part in _re.split(r'(?<=[.!?។៕])\s+|\s+', line):
        nxt = f'{cur} {part}'.strip()
        if len(nxt) <= MAX_CHARS:
            cur = nxt
        else:
            if cur: out.append(cur)
            cur = part[:MAX_CHARS]
    if cur: out.append(cur)
    return out


def translate_text(text: str, src: str, dst: str) -> str:
    """Keeps line breaks: every non-empty line is translated on its own so the scene structure survives."""
    if src == dst:
        return text
    from deep_translator import GoogleTranslator
    tr = GoogleTranslator(source=LANG[src], target=LANG[dst])
    out = []
    for line in text.replace('\r', '').split('\n'):
        if not line.strip():
            out.append('')
            continue
        out.append(' '.join((tr.translate(p) or '') for p in _pieces(line.strip())))
    return '\n'.join(out)

@app.post('/translate')
async def translate_route(request: Request):
    body = await request.json()
    text, src, dst = str(body.get('text', '')), body.get('from'), body.get('to')
    if not text.strip() or src not in ('km', 'en') or dst not in ('km', 'en'):
        return JSONResponse({'ok': False, 'error': 'invalid request'}, status_code=400)
    try:
        return {'ok': True, 'text': await asyncio.to_thread(translate_text, text[:6000], src, dst)}
    except Exception as e:
        return JSONResponse({'ok': False, 'error': str(e)[:160]}, status_code=502)

# ---- render-begin: Timeline Editor renderer (FFmpeg + OpenCV), embedded from worker/render/render_api.py ----
import base64 as _b64, gzip as _gz
from pathlib import Path
_RENDER_SRC = (
    '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'
    'dWqs7pBbTmH5NXJ76eufAKcVeYMuYQAA'
)
if not TEST:
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'fonttools'], check=False)
Path('/content' if os.path.isdir('/content') else '.').joinpath('render_api.py').write_bytes(_gz.decompress(_b64.b64decode(_RENDER_SRC)))
sys.path.insert(0, '/content' if os.path.isdir('/content') else '.')
import render_api
render_api.register(app, lambda: PUBLIC_URL)
# ---- render-end ----

@app.get('/ping')
@app.get('/hardware')
@app.get('/health')
def ping(): return hardware()

@app.post('/run')                      # async: what IPS edit uses (RunPod-style contract)
async def run(body: dict):
    try: jid = enqueue(body)
    except Exception as e: return JSONResponse({'error': str(e)}, status_code=400)
    return {'id': jid, 'status': 'IN_QUEUE'}

@app.get('/status/{jid}')
def status(jid: str):
    j = JOBS.get(jid)
    if not j: return JSONResponse({'error': 'unknown job'}, status_code=404)
    return {'id': jid, 'status': j['status'], 'output': j.get('output'), 'error': j.get('error')}

@app.post('/generate-video')           # sync: waits and returns the mp4. A free tunnel cuts requests at ~100 s, so use /run for real work.
async def generate_video(body: dict):
    try: jid = enqueue(body)
    except Exception as e: return JSONResponse({'error': str(e)}, status_code=400)
    while JOBS[jid]['status'] in ('IN_QUEUE', 'IN_PROGRESS'): await asyncio.sleep(1)
    if JOBS[jid]['status'] != 'COMPLETED': return JSONResponse({'error': JOBS[jid].get('error', 'failed')}, status_code=500)
    return FileResponse(f'{OUT_DIR}/{jid}.mp4', media_type='video/mp4', filename=f'{jid}.mp4')

@app.get('/files/{name}')
def files(name: str):
    if not re.fullmatch(r'[A-Za-z0-9_-]{8,40}\.mp4', name) or not os.path.exists(f'{OUT_DIR}/{name}'):
        return JSONResponse({'error': 'not found'}, status_code=404)
    return FileResponse(f'{OUT_DIR}/{name}', media_type='video/mp4')

# ---------------------------------------------------------------- tunnel + start
def start_tunnel(port):
    exe = '/content/cloudflared'
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

if __name__ == '__main__' and not TEST:
    import uvicorn
    start_worker()
    threading.Thread(target=lambda: uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=PORT, log_level='warning')).run(), daemon=True).start()
    time.sleep(2)
    PUBLIC_URL = start_tunnel(PORT)
    print('\n' + '=' * 64)
    print('  API URL :', PUBLIC_URL)
    print('  API KEY :', API_KEY)
    print('=' * 64)
    print('Copy both into IPS edit -> Command Center -> Video Engine -> Connect.')
    print('Keep this cell running. The model loads in the background; the green light shows when ready.\n')
    while True:
        time.sleep(300)
        h = hardware(); print(time.strftime('%H:%M'), 'ready' if h['ready'] else 'loading', f"| active tasks {h['active_tasks']}")
