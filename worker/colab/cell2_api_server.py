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
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '-U', 'diffusers', 'transformers', 'accelerate', 'sentencepiece',
                    'ftfy', 'imageio', 'imageio-ffmpeg', 'fastapi', 'uvicorn', 'python-multipart', 'requests', 'pillow'], check=True)
    from google.colab import drive
    drive.mount('/content/drive')

import requests
from PIL import Image
from fastapi import FastAPI
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
