"""Music Engine server (RunPod Pod):  MUSIC_KEY=secret uvicorn music_api:app --host 0.0.0.0 --port 8000
POST /render (multipart; signature_voice is MANDATORY) -> {job_id};  GET /status/{id};  GET /download/{id};  GET /health;  GET /hardware."""
import hmac, json, os, shutil, subprocess, tempfile, threading, time, uuid
from pathlib import Path
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import idle
import pipeline

KEY = os.environ.get('MUSIC_KEY', '')
app = FastAPI()
JOBS: dict[str, dict] = {}
GPU = threading.Lock()   # one render at a time keeps VRAM safe
ROOT = Path(os.environ.get('MUSIC_TMP', '/workspace/music_jobs')); ROOT.mkdir(parents=True, exist_ok=True)


@app.middleware('http')
async def guard(request: Request, call_next):
    open_ = request.method == 'OPTIONS' or request.url.path in ('/health', '/ping')
    if KEY and not open_ and not hmac.compare_digest(request.headers.get('authorization', '').encode('utf-8', 'ignore'), f'Bearer {KEY}'.encode()):
        return JSONResponse({'error': 'unauthorized'}, status_code=401)
    return await call_next(request)


app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])   # added last = outermost: answers browser preflights


@app.get('/ping')
@app.get('/health')
def health():
    return {'ok': True}


@app.get('/hardware')
def hardware():
    gpu, total, used = 'CPU', None, None
    try:
        o = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,memory.used', '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=5).stdout.split(',')
        gpu, total, used = o[0].strip(), float(o[1]) / 1024, float(o[2]) / 1024
    except Exception: pass  # noqa: BLE001
    d = shutil.disk_usage('/')
    active = sum(1 for j in JOBS.values() if j['status'] in ('QUEUED', 'RUNNING'))
    return {'ok': True, 'gpu': gpu, 'vram_total_gb': None if total is None else round(total, 1), 'vram_used_gb': None if used is None else round(used, 1),
            'disk_total_gb': round(d.total / 1e9, 1), 'disk_used_gb': round(d.used / 1e9, 1), 'model': 'ACE-Step 1.5 + Demucs + Seed-VC/RVC', 'active_tasks': active}


def _work(jid: str, p: dict, voice: Path, index: Path | None, up: dict):
    j = JOBS[jid]
    def report(step, pct, log):
        j.update(step=step, percent=pct); j['logs'].append(log); j['logs'] = j['logs'][-40:]
    idle.INFLIGHT['n'] += 1   # a running render keeps the Pod alive even if the phone is locked and nobody polls
    try:
        with GPU:
            j['status'] = 'RUNNING'
            out = ROOT / jid / f"{p['title']}.mp3"
            j['duration_sec'] = pipeline.render(p, voice, index, out, report, lambda: j['cancel'])
            j['mp3_filename'] = out.name; j['path'] = str(out)
            report(7, 92, '● [7/7] កំពុងផ្ទុក .MP3 ចូល Supabase Document...')
            j['supabase_saved'] = bool(up.get('url') and pipeline.upload(up['url'], out, up['cb'], up['token']))
            j.update(step=7, percent=100, status='DONE')
            report(7, 100, f"✅ [7/7] រួចរាល់ ១០០%! {out.name} " + ('បានផ្ទុកក្នុង Document (Supabase) ហើយ' if j['supabase_saved'] else 'រួចរាល់ (រក្សាទុកតាម browser)'))
            if j['supabase_saved']: idle.stop_after(30)
    except pipeline.Cancelled:
        j.update(status='FAILED', error='cancelled')
    except Exception as e:  # noqa: BLE001
        j.update(status='FAILED', error=str(e)[:500]); j['logs'].append(f'✕ {str(e)[:300]}')
    finally:
        voice.unlink(missing_ok=True)
        idle.INFLIGHT['n'] -= 1; idle.touch()


@app.post('/render')
async def render(signature_voice: UploadFile | None = File(None), rvc_index: UploadFile | None = File(None), params: str = Form('{}'),
                 signed_upload_url: str = Form(''), complete_callback_url: str = Form(''), complete_token: str = Form('')):
    if signature_voice is None or not signature_voice.filename:
        return JSONResponse({'error': 'signature_voice is required: the song is never sung by a default AI voice'}, status_code=400)
    try: p = json.loads(params)
    except Exception: return JSONResponse({'error': 'params must be JSON'}, status_code=400)  # noqa: BLE001
    if not str(p.get('lyrics', '')).strip(): return JSONResponse({'error': 'lyrics are required'}, status_code=400)
    p['title'] = ''.join(ch for ch in str(p.get('title') or 'Song') if ch.isalnum() or ch in '_-') or 'Song'
    jid = uuid.uuid4().hex[:12]; d = ROOT / jid; d.mkdir(parents=True, exist_ok=True)
    voice = d / f"voice{Path(signature_voice.filename).suffix.lower() or '.wav'}"; voice.write_bytes(await signature_voice.read())
    index = None
    if rvc_index is not None and rvc_index.filename:
        index = d / 'model.index'; index.write_bytes(await rvc_index.read())
    JOBS[jid] = {'status': 'QUEUED', 'step': 2, 'percent': 15, 'logs': ['● [2/7] ទទួលបានការងារ… ចូលជួរ GPU'], 'error': None, 'mp3_filename': None, 'duration_sec': None, 'supabase_saved': False, 'cancel': False, 'created': time.time()}
    up = {'url': signed_upload_url, 'cb': complete_callback_url, 'token': complete_token}
    JOBS[jid]['fin'] = {'cb': complete_callback_url, 'token': complete_token}      # read by the Omni-Worker (failure alerts, timeouts)
    JOBS[jid]['spec'] = {'p': p, 'voice': str(voice), 'index': str(index) if index else None, 'up': up}   # lets the Omni-Worker resume after a crash
    threading.Thread(target=_work, args=(jid, p, voice, index, up), daemon=True).start()
    return {'job_id': jid}


def _pub(j: dict) -> dict:
    return {k: j[k] for k in ('status', 'step', 'percent', 'logs', 'error', 'mp3_filename', 'duration_sec', 'supabase_saved')}


@app.get('/status/{jid}')
def status(jid: str):
    j = JOBS.get(jid)
    return _pub(j) if j else JSONResponse({'error': 'unknown job'}, status_code=404)


@app.get('/download/{jid}')
def download(jid: str):
    j = JOBS.get(jid)
    if not j or j.get('status') != 'DONE' or not j.get('path') or not Path(j['path']).exists(): return JSONResponse({'error': 'not ready'}, status_code=404)
    return FileResponse(j['path'], media_type='audio/mpeg', filename=j['mp3_filename'])


@app.post('/cancel/{jid}')
def cancel(jid: str):
    if jid in JOBS: JOBS[jid]['cancel'] = True
    return {'ok': True}


idle.start(app)
