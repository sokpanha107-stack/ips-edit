# ===== Cell 2: IPS GPU API server (Wan2.2 TI2V-5B). Hardware-agnostic: T4 / L4 / A100. =====
# Prints an API URL + API KEY. Put both in IPS edit -> Command Center -> Video Engine -> Connect.
import asyncio, base64, hmac, io, json, math, os, queue, re, secrets, shutil, subprocess, sys, threading, time, traceback, uuid

ROLE = os.environ.get('IPS_ROLE', 'both')   # 'both' | 'video' | 'image': use 'image' on a second Colab so the Wan model is not loaded there
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
    try:
        if ROLE == 'image':
            ENGINE.tier = 'image-only'; ENGINE.pipe = object(); ENGINE.gpu = 'GPU'
            try:
                import torch; ENGINE.gpu = torch.cuda.get_device_properties(0).name
            except Exception: pass
        else: ENGINE.load()
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
            'model': ('SDXL + IP-Adapter (images)' if ROLE == 'image' else 'Wan2.2-TI2V-5B' + ('' if ENGINE.pipe else ' (loading…)')), 'mode': ENGINE.tier, 'ready': bool(ENGINE.pipe) and not ENGINE.error,
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
    'BCpUj8qlayMNw0O598xZC9RXXdEQNgj1Hcq4X3HEMhrvfdzo/A6w9uwc1gD4sCmiXdTxtB9oJ1oaDMUb3sgNlcpcxM+mm8xW5Zd0'
    '3HV1iG458LYHUkVkFUVs6W3nIeVtzGpUhUtJycoriqtfIDuaBbcA75qK27i8Z9mQCBV+2sJoxPzuYf/cSNM9KUY8TbVDa2Yie3gF'
    'LH5dnJzWIBx6e1JV+udFxkIHGGstunB/Zmftu98//8LHV5x8aj97flo7fX735Dm+lOxYE1MyHtBOgubdrVQE2B0LuRKk4ezOp9he'
    'TCqU8M6+uTBiiHedC4bX3zuJww6z7Rabrh6OqC7tQnC117LJiymJnQUSYneX97qbVmGIa3kk9nIrHg6BkfY6Pzyhd0/Kq5oV8FKz'
    'c8nOD3cFk8HH0GGFn89S14RKwFjiA0QmFs9V0gfjfGZZv38uVj/ObAkHWXRo5vrZ7u47P9Pd7e/6D3O3g2yL1vHwE1wOZVbLuX/H'
    '5WA2W3E63LplXA63TI6l2UzNESBGfnDQOy2faKQ+byPGs0LLW29Kkn4qCpJmf3lyPtOlxvrdY+/qM8NMJvblLkQx4Mvp6XzmHKv3'
    '13l+VZMs58ezxUNqMZ729wWzTlHWJS+VdZ4qE5WHoOdzpJ0fFTVpC2TXk33jSun43ralaVe5QGPFjKN0/KeorrSvAOXvka8Vv4j8'
    'zU9jlPxxW5s2M22LBedNX1E23p+vWk3KLTZftkpJRNWd98NnRJipo1W1tjPPhrU7W5ISg83z/gCnbftpyeRAZm1NekWrJcMtVn9d'
    'Yj+ANE4uLP1621m79e38QV46MNk7x+VkV7dYTj40g6G4P3OP3hXrX5rn8BA3ki3FLcY/JKW27rq1FlqSEqZQADTyKFqOOIeG2oxx'
    'nM1le3kNcvgmPL4jfrlxS2OLAQhdcCwFkrHaxtGnLPwLppm3dPK8LpYbCFF825Reto/Nt1X7+LAiSIL5IIoL/E3h25NNG7tXgFP4'
    'qcr32y3ZtbWjT3sSKmpWtMmALGxWU7KYc7rc0ial2629vcKLQW7ubO34k7R0dLxhjevAsIOkmEs6vbdzlFtvs2VVgXPYtIIu9lck'
    'pGFPTDdv+MdfxGPoJ1ARSsAPdeEhr24B/E0n0O27TG/VuCvBLr8UVF0v42oyL/EwHqJ+VcPjewpIfBrBqYXmewVkBak65aLHgJZs'
    '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'
)
if not TEST:
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'fonttools'], check=False)
Path('/content' if os.path.isdir('/content') else '.').joinpath('render_api.py').write_bytes(_gz.decompress(_b64.b64decode(_RENDER_SRC)))
sys.path.insert(0, '/content' if os.path.isdir('/content') else '.')
import render_api
render_api.register(app, lambda: PUBLIC_URL)
_IMAGE_SRC = (
    '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'
    'fQ5tednZb6G3AixhfEod1E64/h+uXDAztR4AAA=='
)
Path('/content' if os.path.isdir('/content') else '.').joinpath('image_api.py').write_bytes(_gz.decompress(_b64.b64decode(_IMAGE_SRC)))
import image_api
image_api.register(app, lambda: PUBLIC_URL)
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
