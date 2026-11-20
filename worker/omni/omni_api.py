"""Atom Edit · Omni-Worker: ONE FastAPI server on ONE RunPod GPU (port 8000) for Image, Music and Timeline Render.

  /image/*   Image Engine   (POST /image/api/generate-image, GET /image/api/generate-image/status/{id}, ...)
  /music/*   Music Engine   (POST /music/render, GET /music/status/{id}, ...)
  /render/*  Timeline Render(POST /render/render, GET /render/render/status/{id}, ...)
  /status    ONE live view for the Command Center (GPU %, VRAM, disk, active model, active job)      /health  /ping

Run:  ATOM_KEY=secret uvicorn omni_api:app --host 0.0.0.0 --port 8000      (worker/omni/start.sh does everything on a fresh Pod)

What makes it safe for a single 24 GB GPU and a locked phone:
  * ONE global GPU lock: image / music / render jobs run one after another (queue); before a job the other engines' models are unloaded
    (model = None, gc.collect(), torch.cuda.empty_cache()) so VRAM never overlaps.
  * Pre-flight: at least ATOM_MIN_FREE_GB (10) free on /workspace, otherwise stale temp is swept, otherwise the job fails clearly.
  * Fire-and-forget: a job that carries a `finalize` spec (signed upload URLs + one-time HMAC token from /api/<engine>/prepare) is uploaded by THIS
    process (3 tries, exponential backoff, deterministic names + upsert) and reported to /api/<engine>/complete. Temp files are deleted right after
    the upload is confirmed (and after a failure). No SUPABASE key is ever on this machine.
  * Hard wall-clock caps per job (ATOM_TIMEOUT_MUSIC_MIN=12, ATOM_TIMEOUT_VIDEO_MIN=25, ATOM_TIMEOUT_IMAGE_MIN=45): cancel -> mark failed with the exact
    scene/step -> alert -> stop the Pod. Running/queued jobs and pending uploads NEVER count as idle.
  * Self-healing: job specs are saved on the volume; after a restart interrupted jobs are re-queued (images skip scenes already uploaded).
"""
import base64, gc, hashlib, hmac, json, os, shutil, subprocess, sys, threading, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
os.environ.setdefault('ATOM_EMBEDDED', '1')                       # the engines' own watchdogs stand down; the Omni watchdog below is the only one
STATE = Path(os.environ.get('ATOM_STATE_DIR', '/workspace/.atom')); STATE.mkdir(parents=True, exist_ok=True)
os.environ.setdefault('IPS_IMAGE_DIR', str(STATE / 'image')); os.environ.setdefault('IPS_RENDER_DIR', str(STATE / 'render'))
os.environ.setdefault('MUSIC_TMP', str(STATE / 'music')); os.environ['MUSIC_KEY'] = ''   # auth is done once, here
os.environ.setdefault('IPS_CACHE_DIR', '/workspace/.cache')
os.environ.setdefault('HF_HOME', '/workspace/.cache/hf'); os.environ.setdefault('TORCH_HOME', '/workspace/.cache/torch')
for d in ('music', 'image', 'render'): sys.path.insert(0, str(ROOT / d))

from fastapi import FastAPI, Request                                       # noqa: E402
from fastapi.middleware.cors import CORSMiddleware                         # noqa: E402
from fastapi.responses import JSONResponse                                 # noqa: E402
import image_api, render_api, music_api                                    # noqa: E402  (music_api pulls its own idle + pipeline)

KEY = os.environ.get('ATOM_KEY') or os.environ.get('MUSIC_KEY_OLD', '')
MIN_FREE_GB = float(os.environ.get('ATOM_MIN_FREE_GB', '10'))
LIMIT_SEC = {'image': float(os.environ.get('ATOM_TIMEOUT_IMAGE_MIN', '45')) * 60, 'music': float(os.environ.get('ATOM_TIMEOUT_MUSIC_MIN', '12')) * 60,
             'video': float(os.environ.get('ATOM_TIMEOUT_VIDEO_MIN', '25')) * 60}
IDLE_SEC = 180
IDLE_ON = os.environ.get('ATOM_IDLE_STOP', os.environ.get('IPS_IDLE_STOP', '1')) != '0'
WORKSPACE = '/workspace' if os.path.isdir('/workspace') else '/'
STARTED = time.time()
ACTIVE = {'kind': None, 'model': None}                                     # which engine's model is loaded right now
INFLIGHT = {'n': 0}
LAST = {'t': time.time()}
FIN: dict[str, dict] = {}                                                  # per-job finalize bookkeeping, key = f'{kind}:{jid}'
RESUME = STATE / 'resume'; RESUME.mkdir(parents=True, exist_ok=True)

# ------------------------------------------------------------------ helpers
def log(*a): print('[omni]', *a, flush=True)


def free_gb() -> float:
    try: return shutil.disk_usage(WORKSPACE).free / 1e9
    except OSError: return 999.0


def free_vram():
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available(): torch.cuda.empty_cache(); torch.cuda.ipc_collect()
    except Exception: pass  # noqa: BLE001


def unload_all_except(kind: str):
    """VRAM swapper: drop every other engine's resident model, then clear the CUDA cache."""
    if kind != 'image' and image_api._PIPE.get('pipe') is not None:
        image_api._PIPE['pipe'] = None; log('unloaded image model')
    if kind != 'video':
        try:
            import motion_fx
            if motion_fx._depth.get('pipe') is not None: motion_fx._depth['pipe'] = None; log('unloaded depth model')
        except Exception: pass  # noqa: BLE001
    free_vram()
    ACTIVE['kind'] = kind


def sweep_stale(max_age_h: float = 1.0):
    """Deletes temp folders of finished/unknown jobs older than max_age_h (never a running job)."""
    now = time.time(); live = {j['id'] for j in list(image_api.JOBS.values()) + list(render_api.JOBS.values()) if j.get('status') in ('QUEUED', 'RUNNING') and 'id' in j}
    live |= {k for k, j in music_api.JOBS.items() if j.get('status') in ('QUEUED', 'RUNNING')}
    for base in (image_api.WORK, image_api.WORK / 'out', render_api.WORK, render_api.OUT, music_api.ROOT):
        if not base.exists(): continue
        for p in base.iterdir():
            try:
                if p.name in live or p.name in ('out',) or now - p.stat().st_mtime < max_age_h * 3600: continue
                shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)
            except OSError: pass


def preflight():
    if free_gb() < MIN_FREE_GB: sweep_stale(0.0 if free_gb() < 2 else 0.25)
    if free_gb() < MIN_FREE_GB: raise RuntimeError(f'Not enough free disk on /workspace: {free_gb():.1f} GB free, {MIN_FREE_GB:.0f} GB needed. Free some space or enlarge the Network Volume.')


class GpuLock:
    """The ONE lock all three engines share. Entering = pre-flight disk check + model swap."""
    def __init__(self, kind): self.kind = kind
    def __enter__(self):
        _LOCK.acquire()
        try: preflight(); unload_all_except(self.kind)
        except BaseException: _LOCK.release(); raise
    def __exit__(self, *a): free_vram(); _LOCK.release()


_LOCK = threading.Lock()
music_api.GPU = GpuLock('music')                                           # music_api does `with GPU:` per job


def _guard(mod, fname, kind, jobs):
    orig = getattr(mod, fname)
    def run(jid):
        try: g = GpuLock(kind); g.__enter__()
        except Exception as e:  # noqa: BLE001
            jobs[jid].update(status='FAILED', stage='Failed', error=str(e)[:500]); return
        try: return orig(jid)
        finally: g.__exit__()
    setattr(mod, fname, run)


_guard(image_api, 'run_job', 'image', image_api.JOBS)
_guard(render_api, 'render_job', 'video', render_api.JOBS)

# ------------------------------------------------------------------ upload to Supabase (signed URL) + completion callback
def put_file(url: str, path: Path, mime: str) -> bool:
    import httpx
    data = path.read_bytes()
    for i in range(3):                                                    # 3 tries, exponential backoff 2 s / 4 s
        try:
            r = httpx.put(url, files=[('', (path.name, data, mime))], data={'cacheControl': '3600'}, headers={'x-upsert': 'true'}, timeout=300)
            if r.status_code < 300: return True
            log('upload', r.status_code, r.text[:120])
        except Exception as e: log('upload error', str(e)[:140])  # noqa: BLE001
        time.sleep(2 * 2 ** i)
    return False


def callback(cb: str, token: str, **kw) -> bool:
    import httpx
    for i in range(3):
        try:
            if httpx.post(cb, json={'token': token, **kw}, timeout=60).status_code < 300: return True
        except Exception as e: log('callback error', str(e)[:140])  # noqa: BLE001
        time.sleep(2 * 2 ** i)
    return False


def _stop_pod() -> bool:
    pod = os.environ.get('RUNPOD_POD_ID', '')
    if not pod: return False
    key = os.environ.get('IPS_RUNPOD_API_KEY') or os.environ.get('RUNPOD_API_KEY', '')
    try:
        req = urllib.request.Request(f'https://rest.runpod.io/v1/pods/{pod}/stop', method='POST', headers={'Authorization': f'Bearer {key}'})
        with urllib.request.urlopen(req, timeout=20) as r:
            if 200 <= r.status < 300: return True
    except Exception as e: log('REST stop failed', str(e)[:140])  # noqa: BLE001
    try: return subprocess.run(['runpodctl', 'stop', 'pod', pod], capture_output=True, timeout=30).returncode == 0
    except Exception: return False  # noqa: BLE001


def busy() -> bool:
    """Queued/running jobs and uploads that are not confirmed yet. A locked phone never makes the Pod idle."""
    if INFLIGHT['n'] > 0: return True
    if any(j.get('status') in ('QUEUED', 'RUNNING') for j in list(image_api.JOBS.values()) + list(render_api.JOBS.values()) + list(music_api.JOBS.values())): return True
    return any(not f.get('closed') for f in FIN.values())


def stop_when_empty(grace: int = 20):
    """Queue empty and everything confirmed saved -> stop the Pod (podStop) after a short grace."""
    if not (IDLE_ON and os.environ.get('RUNPOD_POD_ID')): return
    def _go():
        time.sleep(grace)
        if not busy(): log('queue empty, all saved: stopping Pod'); _stop_pod()
    threading.Thread(target=_go, daemon=True).start()


# ------------------------------------------------------------------ finalize watcher (uploads + notifications + hard timeouts + resume records)
def _save_resume(kind: str, jid: str, rec: dict):
    try: (RESUME / f'{kind}-{jid}.json').write_text(json.dumps(rec, default=str))
    except OSError: pass


def _drop_resume(kind: str, jid: str): (RESUME / f'{kind}-{jid}.json').unlink(missing_ok=True)


def _fail(kind: str, jid: str, fin: dict, where: str, why: str):
    if fin.get('closed'): return
    fin['closed'] = True
    if fin.get('cb'): callback(fin['cb'], fin['token'], event='failed', step=where, error=why[:400])
    _drop_resume(kind, jid); log(kind, jid, 'FAILED at', where, why[:160])


def _timeout_check(kind: str, jid: str, job: dict, fin: dict, lim_key: str):
    age = time.time() - fin['t0']
    if job.get('status') in ('QUEUED', 'RUNNING') and age > LIMIT_SEC[lim_key]:
        if not fin.get('timeout_at'):
            job['cancel'] = True; fin['timeout_at'] = time.time(); log(kind, jid, 'hard timeout, cancelling')
        elif time.time() - fin['timeout_at'] > 90 and not fin.get('closed'):    # did not stop by itself: terminate for real
            where = _where(kind, job)
            subprocess.run(['pkill', '-f', 'ffmpeg'], capture_output=True) if kind == 'video' else None
            job['status'] = 'FAILED'; job['error'] = 'hard timeout'
            _fail(kind, jid, fin, where, f'Hard time limit ({int(LIMIT_SEC[lim_key] / 60)} min) reached; the job was stopped to protect billing.')
            if IDLE_ON and os.environ.get('RUNPOD_POD_ID'): _stop_pod()
        return True
    return False


def _where(kind: str, job: dict) -> str:
    if kind == 'image': return str(min(int(job.get('total') or 0), int(job.get('done') or 0) + 1))
    if kind == 'music': return str(job.get('step') or '?')
    return str(job.get('stage') or '?')


def _watch_image():
    for jid, job in list(image_api.JOBS.items()):
        fz = (job.get('payload') or {}).get('finalize')
        if not fz: continue
        k = f'image:{jid}'
        off = int(fz.get('offset') or 0)                                       # slot numbers are global (scene-001 ...), image indexes are relative to this job
        fin = FIN.setdefault(k, {'t0': job.get('created') or time.time(), 'cb': fz['callback'], 'token': fz['token'], 'sent': {int(x) + off for x in (job['payload'].get('skip') or [])}, 'tries': 0})
        if fin.get('closed'): continue
        slots = {int(s['index']): s for s in fz['slots']}
        _save_resume('image', jid, {'jid': jid, 'payload': job['payload'], 'sig': str(job['sig']), 'sent': sorted(fin['sent']), 'created': fin['t0']})
        if _timeout_check('image', jid, job, fin, 'image'): pass
        out = image_api.WORK / 'out' / jid
        new = []
        for im in list(job['images']):
            i = int(im['index']) + off
            if i in fin['sent'] or i not in slots: continue
            p = out / im['name']
            if p.exists() and put_file(slots[i]['uploadUrl'], p, 'image/png'):
                fin['sent'].add(i); new.append({'path': slots[i]['path'], 'name': slots[i]['name']}); p.unlink(missing_ok=True)   # temp frame deleted right after confirmed upload
            else: fin['tries'] += 1
        job['saved'] = len([i for i in fin['sent'] if off < i <= off + int(job.get('total') or 0)])   # uploaded + confirmed (the app reads this)
        if new:
            callback(fin['cb'], fz['token'], event='scene', files=new, step=len(fin['sent']), total=off + int(job['total']))
        st = job.get('status')
        total = int(job.get('total') or len(job['payload'].get('prompts', [])))
        if st == 'DONE' and job['saved'] >= total:
            fin['closed'] = True
            callback(fin['cb'], fz['token'], event='done', files=[], step=off + total, total=off + total)
            shutil.rmtree(out, ignore_errors=True); shutil.rmtree(image_api.WORK / jid, ignore_errors=True); _drop_resume('image', jid)
            stop_when_empty()
        elif st in ('FAILED', 'CANCELLED') or fin['tries'] >= 12:
            if st == 'CANCELLED' and not fin.get('timeout_at'):
                fin['closed'] = True; _drop_resume('image', jid); stop_when_empty()    # the user cancelled: no alert
            else:
                _fail('image', jid, fin, _where('image', job), job.get('error') or ('time limit' if fin.get('timeout_at') else 'upload failed'))
                if IDLE_ON: stop_when_empty()
            shutil.rmtree(out, ignore_errors=True); shutil.rmtree(image_api.WORK / jid, ignore_errors=True)


def _watch_render():
    for jid, job in list(render_api.JOBS.items()):
        fz = (job.get('payload') or {}).get('finalize')
        if not fz: continue
        k = f'video:{jid}'
        fin = FIN.setdefault(k, {'t0': job.get('created') or time.time(), 'cb': fz['callback'], 'token': fz['token']})
        if fin.get('closed'): continue
        _save_resume('video', jid, {'jid': jid, 'payload': job['payload'], 'files': {a: str(b) for a, b in (job.get('files') or {}).items()}, 'dir': str(job.get('dir')), 'created': fin['t0']})
        _timeout_check('video', jid, job, fin, 'video')
        st = job.get('status')
        if st == 'DONE' and job.get('file'):
            mp4 = render_api.OUT / job['file']
            if mp4.exists() and put_file(fz['uploadUrl'], mp4, 'video/mp4'):
                fin['closed'] = True
                callback(fin['cb'], fz['token'], event='done', files=[{'path': fz['path'], 'name': fz['name']}], step=1, total=1)
                mp4.unlink(missing_ok=True); job['saved'] = True; _drop_resume('video', jid); stop_when_empty()    # temp .mp4 deleted after confirmed upload
            else:
                fin['tries'] = fin.get('tries', 0) + 1
                if fin['tries'] >= 4: _fail('video', jid, fin, 'upload', 'Could not upload the finished video to Document.'); mp4.unlink(missing_ok=True); stop_when_empty()
        elif st in ('FAILED', 'CANCELLED'):
            if st == 'CANCELLED' and not fin.get('timeout_at'): fin['closed'] = True; _drop_resume('video', jid)
            else: _fail('video', jid, fin, _where('video', job), job.get('error') or ('time limit' if fin.get('timeout_at') else 'render failed')); stop_when_empty()
            shutil.rmtree(job.get('dir') or '', ignore_errors=True)


def _watch_music():
    for jid, job in list(music_api.JOBS.items()):
        fz = job.get('fin')
        if not fz: continue
        k = f'music:{jid}'
        fin = FIN.setdefault(k, {'t0': time.time(), 'cb': fz['cb'], 'token': fz['token']})
        if fin.get('closed'): continue
        spec = job.get('spec')
        if spec: _save_resume('music', jid, {'jid': jid, **spec, 'created': fin['t0']})
        _timeout_check('music', jid, job, fin, 'music')
        st = job.get('status')
        if st == 'DONE' and job.get('supabase_saved'):                          # music_api already uploaded + sent the "done" callback
            fin['closed'] = True; _drop_resume('music', jid)
            shutil.rmtree(music_api.ROOT / jid, ignore_errors=True); stop_when_empty()
        elif st == 'DONE':                                                       # finished but the upload failed: try again here
            mp3 = Path(job.get('path') or '')
            if mp3.exists() and put_file(spec['up']['url'], mp3, 'audio/mpeg') and callback(fin['cb'], fin['token'], event='done'):
                job['supabase_saved'] = True
            else:
                fin['tries'] = fin.get('tries', 0) + 1
                if fin['tries'] >= 4: _fail('music', jid, fin, 'upload', 'Could not upload the finished song to Document.'); stop_when_empty()
        elif st == 'FAILED':
            if job.get('error') == 'cancelled' and not fin.get('timeout_at'): fin['closed'] = True; _drop_resume('music', jid)
            else: _fail('music', jid, fin, _where('music', job), job.get('error') or 'failed'); stop_when_empty()
            shutil.rmtree(music_api.ROOT / jid, ignore_errors=True)


def _watcher():
    while True:
        time.sleep(2)
        for fn in (_watch_image, _watch_render, _watch_music):
            try: fn()
            except Exception as e: log('watcher', fn.__name__, str(e)[:200])  # noqa: BLE001


# ------------------------------------------------------------------ self-healing: re-queue what a crash/restart interrupted
def resume_all():
    n = 0
    for f in sorted(RESUME.glob('*.json')):
        try:
            r = json.loads(f.read_text()); kind = f.name.split('-', 1)[0]; age = time.time() - float(r.get('created') or 0)
            fz = (r.get('payload') or {}).get('finalize') if kind != 'music' else {'callback': (r.get('up') or {}).get('cb'), 'token': (r.get('up') or {}).get('token')}
            if age > LIMIT_SEC['video' if kind == 'video' else kind] * 1.5: f.unlink(missing_ok=True); continue    # too old: the token is dead too
            if kind == 'image' and Path(r['sig']).exists():
                P = r['payload']; off = int((P.get('finalize') or {}).get('offset') or 0); P['skip'] = [g - off for g in r.get('sent', []) if g - off >= 1]
                image_api.JOBS[r['jid']] = {'id': r['jid'], 'status': 'QUEUED', 'progress': 0.0, 'stage': 'Resumed', 'done': 0, 'total': len(P['prompts']), 'images': [], 'payload': P,
                                            'sig': Path(r['sig']), 'created': float(r['created'])}
                image_api.Q.put(r['jid']); n += 1
            elif kind == 'video' and all(Path(v).exists() for v in r.get('files', {}).values()):
                render_api.JOBS[r['jid']] = {'id': r['jid'], 'status': 'QUEUED', 'progress': 0.0, 'stage': 'Resumed', 'dir': Path(r['dir']), 'files': {a: Path(b) for a, b in r['files'].items()},
                                             'payload': r['payload'], 'created': float(r['created'])}
                render_api.Q.put(r['jid']); n += 1
            elif kind == 'music' and Path(r['voice']).exists():
                jid = r['jid']; up = r['up']
                music_api.JOBS[jid] = {'status': 'QUEUED', 'step': 2, 'percent': 15, 'logs': ['● ចាប់ផ្តើមឡើងវិញដោយស្វ័យប្រវត្តិ (Auto-Resume)'], 'error': None, 'mp3_filename': None, 'duration_sec': None,
                                       'supabase_saved': False, 'cancel': False, 'fin': {'cb': up['cb'], 'token': up['token']}, 'spec': {k: r[k] for k in ('p', 'voice', 'index', 'up')}}
                threading.Thread(target=music_api._work, args=(jid, r['p'], Path(r['voice']), Path(r['index']) if r.get('index') else None, up), daemon=True).start(); n += 1
            else: f.unlink(missing_ok=True)
        except Exception as e: log('resume failed', f.name, str(e)[:160])  # noqa: BLE001
    if n: log(f'auto-resumed {n} interrupted job(s)')


# ------------------------------------------------------------------ idle watchdog (the only one)
def _idle_loop():
    while True:
        time.sleep(10)
        if busy() or time.time() - LAST['t'] < IDLE_SEC: continue
        log(f'idle {int(time.time() - LAST["t"])}s with no job: stopping the Pod')
        if _stop_pod(): return
        time.sleep(60)


# ------------------------------------------------------------------ app
app = FastAPI()


def _b64d(s: str) -> bytes: return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def auth_ok(header: str) -> bool:
    """Bearer <ATOM_KEY> (server-side callers) or Bearer <short-lived HMAC token minted by /api/gpu/token> (the browser)."""
    if not KEY: return True
    t = header[7:].strip() if header.lower().startswith('bearer ') else ''
    if not t: return False
    if hmac.compare_digest(t.encode('utf-8', 'ignore'), KEY.encode()): return True
    try:
        body, sig = t.split('.')
        good = base64.urlsafe_b64encode(hmac.new(KEY.encode(), body.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
        return hmac.compare_digest(sig, good) and float(json.loads(_b64d(body)).get('e', 0)) > time.time()
    except Exception: return False  # noqa: BLE001


@app.middleware('http')
async def guard(request: Request, call_next):
    p = request.url.path
    open_ = request.method == 'OPTIONS' or p in ('/health', '/ping') or '/files/' in p
    if not open_ and not auth_ok(request.headers.get('authorization', '')):
        return JSONResponse({'error': 'unauthorized'}, status_code=401)
    counts = request.method not in ('OPTIONS', 'GET', 'HEAD')                  # polling never keeps the Pod alive; running jobs do (busy())
    if counts: LAST['t'] = time.time(); INFLIGHT['n'] += 1
    try: return await call_next(request)
    finally:
        if counts: INFLIGHT['n'] -= 1; LAST['t'] = time.time()


@app.get('/ping')
@app.get('/health')
def health(): return {'ok': True, 'engine': 'atom-omni', 'version': '2.4'}


def _gpu():
    gpu, total, used, util = 'CPU', None, None, None
    try:
        o = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,memory.used,utilization.gpu', '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=5).stdout.split(',')
        gpu, total, used, util = o[0].strip(), float(o[1]) / 1024, float(o[2]) / 1024, float(o[3])
    except Exception: pass  # noqa: BLE001
    return gpu, total, used, util


@app.get('/status')
def status():
    """ONE payload for the single GPU Performance Monitor: what is running, which model, progress, GPU %, VRAM, disk."""
    gpu, total, used, util = _gpu()
    d = shutil.disk_usage(WORKSPACE)
    img = [j for j in image_api.JOBS.values() if j.get('status') in ('QUEUED', 'RUNNING')]
    vid = [j for j in render_api.JOBS.values() if j.get('status') in ('QUEUED', 'RUNNING')]
    mus = [j for j in music_api.JOBS.values() if j.get('status') in ('QUEUED', 'RUNNING')]
    cur, kind, model, step, tot, pct, title = None, 'idle', None, None, None, None, None
    run = lambda L: next((j for j in L if j.get('status') == 'RUNNING'), L[0] if L else None)   # noqa: E731
    if run(img) or run(mus) or run(vid):
        if run(img) and run(img).get('status') == 'RUNNING': cur, kind = run(img), 'image'
        elif run(mus) and run(mus).get('status') == 'RUNNING': cur, kind = run(mus), 'music'
        elif run(vid) and run(vid).get('status') == 'RUNNING': cur, kind = run(vid), 'render'
        else: cur, kind = (run(img) or run(mus) or run(vid)), ('image' if img else 'music' if mus else 'render')
    if kind == 'image' and cur:
        model = ('FLUX.2 klein 4B' if image_api.MODEL == 'klein' else 'SDXL + IP-Adapter') + (' (mock)' if image_api.MOCK else ''); step, tot, pct = cur.get('done'), cur.get('total'), cur.get('progress')
    elif kind == 'music' and cur:
        s = int(cur.get('step') or 2); model = {2: 'ACE-Step', 3: 'ACE-Step', 4: 'Demucs', 5: 'Seed-VC / RVC', 6: 'FFmpeg Master', 7: 'Upload'}.get(s, 'Music'); step, tot, pct = s, 7, cur.get('percent')
    elif kind == 'render' and cur:
        model = 'Depth-Anything / NVENC'; pct = cur.get('progress'); title = cur.get('stage')
    return {'ok': True, 'state': kind, 'model': model, 'loaded': ACTIVE['kind'], 'step': step, 'total': tot, 'percent': pct, 'title': title,
            'gpu': gpu, 'gpu_util': util, 'vram_total_gb': None if total is None else round(total, 1), 'vram_used_gb': None if used is None else round(used, 1),
            'disk_total_gb': round(d.total / 1e9, 1), 'disk_used_gb': round(d.used / 1e9, 1), 'disk_free_gb': round(d.free / 1e9, 1),
            'active_tasks': len(img) + len(vid) + len(mus), 'queued': {'image': len(img), 'music': len(mus), 'render': len(vid)}, 'uptime': int(time.time() - STARTED)}


@app.get('/hardware')
def hardware():                                                                 # same contract as the old engines so /api/connect keeps working
    s = status()
    return {'ok': True, 'gpu': s['gpu'], 'vram_total_gb': s['vram_total_gb'], 'vram_used_gb': s['vram_used_gb'], 'disk_total_gb': s['disk_total_gb'], 'disk_used_gb': s['disk_used_gb'],
            'model': s['model'] or 'Atom Omni (Image · Music · Render)', 'active_tasks': s['active_tasks']}


_si, _sr = FastAPI(), FastAPI()
image_api.register(_si); render_api.register(_sr)
app.mount('/image', _si); app.mount('/render', _sr); app.mount('/music', music_api.app)
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])   # added last = outermost: answers browser preflights

for _t in (_watcher, _idle_loop): threading.Thread(target=_t, daemon=True).start()
threading.Thread(target=resume_all, daemon=True).start()
log(f'Atom Omni-Worker ready · caps image {LIMIT_SEC["image"] / 60:.0f} / music {LIMIT_SEC["music"] / 60:.0f} / video {LIMIT_SEC["video"] / 60:.0f} min · idle stop {"ON" if IDLE_ON else "OFF"}')
