"""Atom Edit · Image Engine (batch reference-guided image generation).

POST /api/generate-image            multipart: `signature` (the base/reference image) + `payload` JSON
                                    {"prompts": ["scene 1 ...", ...up to 100], "width": 768, "height": 1344, "scale": 0.6, "steps": 30, "seed": 123, "negative": "..."}
                                    -> {"ok": true, "id": "..."}
GET  /api/generate-image/status/{id} -> {status, progress, done, total, images:[{index,name,url}], error}   (images appear one by one)
POST /api/generate-image/cancel/{id}
GET  /files/images/{id}/{name}      -> the picture (unguessable id; no header needed)

Model: SDXL base + IP-Adapter (the Signature Image is used as an image prompt, so the character/style stays the same in every scene).
Set IPS_IMAGE_MOCK=1 to test the whole flow without a GPU (draws placeholder pictures).
"""
import io, json, os, queue, re, shutil, tempfile, threading, time, traceback, uuid
from pathlib import Path

WORK = Path(os.environ.get('IPS_IMAGE_DIR', tempfile.gettempdir())) / 'ips_images'
MOCK = os.environ.get('IPS_IMAGE_MOCK') == '1'
MODEL = os.environ.get('IPS_IMAGE_MODEL', 'klein')   # 'klein' = FLUX.2 klein 4B (default) | 'sdxl' = SDXL + IP-Adapter
MODELS_DIR = os.environ.get('IPS_MODELS_DIR', '/content/drive/MyDrive/IPS_Models')
KLEIN_ID = 'black-forest-labs/FLUX.2-klein-4B'
KEEP = 'Keep exactly the same character (face, hair, skin tone, clothes) and the same illustration art style as the reference image. New scene: '
MAX_PROMPTS = int(os.environ.get('ATOM_MAX_SCENES', '2000'))   # was a fixed 100: batches are unlimited now (checkpointed + auto-resume)
JOBS: dict = {}
Q: 'queue.Queue[str]' = queue.Queue()
_PIPE = {'pipe': None, 'error': None}


def _gpu_total_gb():
    import torch
    return torch.cuda.get_device_properties(0).total_memory / 1e9 if torch.cuda.is_available() else 0


def load_pipe():
    """Loads the image model once (first job). Klein reads the copy saved in Google Drive when it exists, otherwise downloads from Hugging Face."""
    if _PIPE['pipe'] is not None: return _PIPE['pipe']
    import torch
    total = _gpu_total_gb()
    if MODEL == 'sdxl':
        from diffusers import StableDiffusionXLPipeline
        pipe = StableDiffusionXLPipeline.from_pretrained('stabilityai/stable-diffusion-xl-base-1.0', torch_dtype=torch.float16, variant='fp16', use_safetensors=True)
        pipe.load_ip_adapter('h94/IP-Adapter', subfolder='sdxl_models', weight_name='ip-adapter_sdxl.bin')
    else:
        from diffusers import Flux2KleinPipeline
        src = next((str(d) for d in (Path(MODELS_DIR) / 'FLUX.2-klein-4B', Path('/content/IPS_Models/FLUX.2-klein-4B')) if (d / '.ips_complete').exists()), KLEIN_ID)
        dtype = torch.bfloat16 if (torch.cuda.is_available() and torch.cuda.get_device_capability(0)[0] >= 8) else torch.float16   # T4 has no bf16
        print('Loading FLUX.2 klein 4B from', src, flush=True)
        pipe = Flux2KleinPipeline.from_pretrained(src, torch_dtype=dtype)
    if total >= 22 and MODEL != 'klein': pipe.to('cuda')
    elif total >= 30: pipe.to('cuda')
    else: pipe.enable_model_cpu_offload()
    try: pipe.enable_vae_tiling()
    except Exception: pass  # noqa: BLE001
    _PIPE['pipe'] = pipe
    return pipe


def generate_one(pipe, sig, prompt, P, w, h, seed):
    import torch
    gen = torch.Generator('cuda' if torch.cuda.is_available() else 'cpu').manual_seed(seed)
    if MODEL == 'sdxl':
        with torch.inference_mode():
            return pipe(prompt=prompt, negative_prompt=P.get('negative') or 'blurry, low quality, deformed, extra fingers, watermark, text', ip_adapter_image=sig,
                        num_inference_steps=int(P.get('steps', 30)), guidance_scale=float(P.get('guidance', 7.0)), width=w, height=h, generator=gen).images[0]
    ref = sig.copy(); ref.thumbnail((1024, 1024))      # reference picture: the Signature Image
    try:
        with torch.inference_mode():
            return pipe(prompt=KEEP + prompt, image=ref, height=h, width=w, guidance_scale=1.0, num_inference_steps=4, generator=gen).images[0]
    except TypeError as e:
        raise RuntimeError(f'This diffusers version does not accept a reference image for FLUX.2 klein ({e}). Re-run the install cell (diffusers from GitHub).') from e


def _mock_image(sig, prompt: str, w: int, h: int, i: int):
    from PIL import Image, ImageDraw
    bg = Image.new('RGB', (w, h), (28 + (i * 37) % 80, 30, 46))
    fit = sig.copy(); fit.thumbnail((int(w * 0.8), int(h * 0.6)))
    bg.paste(fit, ((w - fit.width) // 2, int(h * 0.12)))
    d = ImageDraw.Draw(bg)
    d.text((20, h - 90), f'Scene {i + 1}', fill=(255, 220, 120))
    d.text((20, h - 60), prompt[:60], fill=(255, 255, 255))
    return bg


def run_job(jid: str):
    job = JOBS[jid]
    try:
        from PIL import Image
        P = job['payload']; job['status'] = 'RUNNING'
        prompts = [str(p).strip() for p in P['prompts'] if str(p).strip()][:MAX_PROMPTS]
        w, h = int(P.get('width', 768)) // 16 * 16, int(P.get('height', 1344)) // 16 * 16   # multiples of 16 suit both models
        w, h = max(256, min(w, 1536)), max(256, min(h, 1536))
        sig = Image.open(job['sig']).convert('RGB')
        out = WORK / 'out' / jid; out.mkdir(parents=True, exist_ok=True)
        job['total'] = len(prompts)
        pipe = None
        if not MOCK:
            job['stage'] = 'Loading image model (first time takes a few minutes)'
            pipe = load_pipe()
            if MODEL == 'sdxl': pipe.set_ip_adapter_scale(float(P.get('scale', 0.6)))
        base_seed = int(P['seed']) if P.get('seed') not in (None, '') else int(time.time()) % 2**31
        pad = int(P.get('pad') or (3 if len(prompts) > 99 else 2))   # the app sends its pad so names match the signed upload slots
        skip = {int(x) for x in (P.get('skip') or [])}    # scenes already saved before a crash (auto-resume)
        for i, prompt in enumerate(prompts):
            if job.get('cancel'): raise RuntimeError('cancelled')
            if (i + 1) in skip:
                job['done'] = i + 1; job['progress'] = round(100 * (i + 1) / len(prompts), 1); continue
            job['stage'] = f'Image {i + 1}/{len(prompts)}'
            if MOCK:
                time.sleep(0.15); img = _mock_image(sig, prompt, w, h, i)
            else:
                img = generate_one(pipe, sig, prompt, P, w, h, base_seed + i)
            name = f'scene-{i + 1:0{pad}d}.png'
            img.save(out / name)
            job['images'].append({'index': i + 1, 'name': name, 'url': f'/files/images/{jid}/{name}'})
            job['done'] = i + 1
            job['progress'] = round(100 * (i + 1) / len(prompts), 1)
        job.update(status='DONE', stage='Done', progress=100.0)
    except Exception as e:  # noqa: BLE001
        cancelled = str(e) == 'cancelled'
        job.update(status='CANCELLED' if cancelled else 'FAILED', stage='Cancelled' if cancelled else 'Failed', error=None if cancelled else str(e)[-600:])
        if not cancelled: traceback.print_exc()


def _worker():
    while True:
        jid = Q.get()
        try:
            if JOBS[jid].get('cancel'): JOBS[jid].update(status='CANCELLED', stage='Cancelled')
            else: run_job(jid)
        finally:
            Q.task_done()


def register(app, public_url=lambda: ''):
    """Adds the Image Engine routes (+ CORS so the PWA can talk to it straight from the browser) to a FastAPI app."""
    from fastapi import Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse

    (WORK / 'out').mkdir(parents=True, exist_ok=True)
    threading.Thread(target=_worker, daemon=True).start()
    if not any(m.cls is CORSMiddleware for m in app.user_middleware):
        app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

    @app.post('/api/generate-image')
    async def generate(request: Request):
        form = await request.form()
        try: payload = json.loads(str(form.get('payload', '')))
        except ValueError: return JSONResponse({'ok': False, 'error': 'payload is not valid JSON'}, status_code=400)
        prompts = [p for p in payload.get('prompts', []) if str(p).strip()]
        sig = form.get('signature')
        if not prompts: return JSONResponse({'ok': False, 'error': 'prompts is empty'}, status_code=400)
        if len(prompts) > MAX_PROMPTS: return JSONResponse({'ok': False, 'error': f'max {MAX_PROMPTS} prompts per batch'}, status_code=400)
        if sig is None or not hasattr(sig, 'read'): return JSONResponse({'ok': False, 'error': 'signature image is required'}, status_code=400)
        jid = uuid.uuid4().hex[:16]
        d = WORK / jid; d.mkdir(parents=True, exist_ok=True)
        sig_path = d / 'signature.img'
        with open(sig_path, 'wb') as fh: shutil.copyfileobj(sig.file, fh)
        JOBS[jid] = {'id': jid, 'status': 'QUEUED', 'progress': 0.0, 'stage': 'Queued', 'done': 0, 'total': len(prompts), 'images': [], 'payload': {**payload, 'prompts': prompts}, 'sig': sig_path, 'created': time.time()}
        Q.put(jid)
        return {'ok': True, 'id': jid, 'queued': Q.qsize()}

    @app.get('/api/generate-image/status/{jid}')
    def status(jid: str):
        j = JOBS.get(jid)
        if not j: return JSONResponse({'ok': False, 'error': 'unknown job'}, status_code=404)
        return {'ok': True, 'status': j['status'], 'progress': j['progress'], 'stage': j['stage'], 'done': j['done'], 'total': j['total'], 'saved': j.get('saved', 0), 'error': j.get('error'),
                'images': [{**im, 'url': f"{public_url()}{im['url']}"} for im in j['images']]}

    @app.post('/api/generate-image/cancel/{jid}')
    def cancel(jid: str):
        if jid in JOBS: JOBS[jid]['cancel'] = True
        return {'ok': True}

    @app.get('/files/images/{jid}/{name}')
    def get_image(jid: str, name: str):
        p = WORK / 'out' / Path(jid).name / Path(name).name
        return FileResponse(p, media_type='image/png') if p.exists() else JSONResponse({'error': 'not found'}, status_code=404)
