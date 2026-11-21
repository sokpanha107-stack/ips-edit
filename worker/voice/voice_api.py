"""Atom Edit · Voice Clone (Khmer + English in the user's Signature Voice), self-hosted on the same GPU as Image / Music / Render.

  POST /api/clone                 multipart: voice = the Signature Voice sample (mp3/wav/m4a, <= 3 MB), payload = JSON
                                  {lang: 'kh'|'en', scenes: [text, ...], gender?: 'female'|'male', pad?: 2, brand?: str, finalize?: {...}, skip?: [n]}
  GET  /api/clone/status/{id}     {status, stage, done, total, progress, saved, durations[], tts, error}
  POST /api/clone/cancel/{id}
  GET  /files/voice/{id}/{name}   finished scene (only for jobs WITHOUT `finalize`)

Pipeline (one scene at a time, strictly one model on the GPU at any moment):
  1. base speech   KH: MMS-TTS (facebook/mms-tts-khm, runs on the GPU)  ->  edge-tts  ->  gTTS     (first one that works; env ATOM_TTS_KH)
                   EN: edge-tts  ->  MMS-TTS (facebook/mms-tts-eng)  ->  gTTS                      (env ATOM_TTS_EN)
  2. the TTS model is unloaded (del, gc.collect(), torch.cuda.empty_cache())
  3. Seed-VC converts every base scene into the Signature Voice (speech mode, f0-condition off) in its own process, so VRAM is released after each scene
  4. FFmpeg -> 01.mp3, 02.mp3 ... (mono 44.1 kHz 192 kbps, tool tags stripped, only the locked brand is written as artist/comment)
Inside the Omni-Worker the global GPU lock + the watcher upload each mp3 to Document (signed URLs), notify, then delete the temp files.
"""
import asyncio, gc, json, os, queue, shutil, subprocess, threading, time, uuid
from pathlib import Path

WORK = Path(os.environ.get('IPS_VOICE_DIR', '/tmp/atom_voice')); WORK.mkdir(parents=True, exist_ok=True)
MAX_SCENES = int(os.environ.get('ATOM_MAX_SCENES', '2000'))
MAX_SAMPLE = 6 * 1024 * 1024
TTS_ORDER = {'kh': os.environ.get('ATOM_TTS_KH', 'mms,edge,gtts').split(','), 'en': os.environ.get('ATOM_TTS_EN', 'edge,mms,gtts').split(',')}
EDGE = {('kh', 'female'): 'km-KH-SreymomNeural', ('kh', 'male'): 'km-KH-PisethNeural', ('en', 'female'): 'en-US-AriaNeural', ('en', 'male'): 'en-US-GuyNeural'}
MMS = {'kh': 'facebook/mms-tts-khm', 'en': 'facebook/mms-tts-eng'}
JOBS: dict[str, dict] = {}
Q: 'queue.Queue[str]' = queue.Queue()
_MMS: dict[str, tuple] = {}


class Cancelled(Exception): ...


def log(*a): print('[voice]', *a, flush=True)


def free_gpu():
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available(): torch.cuda.empty_cache()
    except Exception: pass  # noqa: BLE001


def unload():
    """Drops the resident TTS model(s) (called after every job and by the Omni VRAM swapper)."""
    _MMS.clear(); free_gpu()


def run(cmd, cwd=None):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if p.returncode != 0: raise RuntimeError(f'{Path(cmd[0]).name} failed: {(p.stderr or p.stdout)[-300:]}')
    return p.stdout


def _split(text: str, limit: int = 220) -> list[str]:
    import re
    parts = [p.strip() for p in re.split(r'(?<=[.!?។៕\n])\s*', text) if p.strip()]
    out, cur = [], ''
    for p in parts:
        if len(cur) + len(p) + 1 <= limit: cur = f'{cur} {p}'.strip()
        else:
            if cur: out.append(cur)
            cur = p
    if cur: out.append(cur)
    return out or [text.strip()]


# ---------------------------------------------------------------- stage 1: base speech (three interchangeable backends)
def tts_mms(text: str, lang: str, out: Path):
    import numpy as np, soundfile as sf, torch
    from transformers import AutoTokenizer, VitsModel
    if lang not in _MMS:
        tok = AutoTokenizer.from_pretrained(MMS[lang]); model = VitsModel.from_pretrained(MMS[lang]).to('cuda' if torch.cuda.is_available() else 'cpu').eval()
        _MMS[lang] = (tok, model)
    tok, model = _MMS[lang]; chunks = []
    for part in _split(text):
        ids = tok(part, return_tensors='pt').to(model.device)
        with torch.no_grad(): chunks.append(model(**ids).waveform[0].float().cpu().numpy())
        chunks.append(np.zeros(int(model.config.sampling_rate * 0.18), dtype='float32'))
    sf.write(str(out), np.concatenate(chunks), model.config.sampling_rate)


def tts_edge(text: str, lang: str, gender: str, out: Path):
    import edge_tts
    mp3 = out.with_suffix('.edge.mp3')
    asyncio.run(edge_tts.Communicate(text, EDGE[(lang, gender)]).save(str(mp3)))
    run(['ffmpeg', '-y', '-v', 'error', '-i', str(mp3), '-ac', '1', '-ar', '24000', str(out)]); mp3.unlink(missing_ok=True)


def tts_gtts(text: str, lang: str, out: Path):
    from gtts import gTTS
    mp3 = out.with_suffix('.gtts.mp3'); gTTS(text, lang='km' if lang == 'kh' else 'en').save(str(mp3))
    run(['ffmpeg', '-y', '-v', 'error', '-i', str(mp3), '-ac', '1', '-ar', '24000', str(out)]); mp3.unlink(missing_ok=True)


def base_speech(text: str, lang: str, gender: str, out: Path) -> str:
    err = []
    for name in TTS_ORDER[lang]:
        try:
            {'mms': lambda: tts_mms(text, lang, out), 'edge': lambda: tts_edge(text, lang, gender, out), 'gtts': lambda: tts_gtts(text, lang, out)}[name.strip()]()
            if out.exists() and out.stat().st_size > 2048: return name.strip()
            err.append(f'{name}: empty')
        except Exception as e: err.append(f'{name}: {str(e)[:120]}'); log('tts', name, 'failed', str(e)[:200])  # noqa: BLE001
    raise RuntimeError('No base TTS worked (' + '; '.join(err) + ')')


# ---------------------------------------------------------------- stage 3: Seed-VC (speech mode) in its own process
def convert(base: Path, voice: Path, work: Path) -> Path:
    sv = os.environ.get('SEEDVC_DIR', '/workspace/models/seed-vc'); outd = work / 'sv'; shutil.rmtree(outd, ignore_errors=True)
    run(['python', 'inference.py', '--source', str(base), '--target', str(voice), '--output', str(outd), '--diffusion-steps', '30', '--length-adjust', '1.0',
         '--inference-cfg-rate', '0.7', '--f0-condition', 'False', '--auto-f0-adjust', 'False', '--fp16', 'True'], cwd=sv)
    got = sorted(outd.glob('*.wav'), key=lambda x: x.stat().st_mtime)
    if not got: raise RuntimeError('Seed-VC produced no audio')
    return got[-1]


def to_mp3(wav: Path, out: Path, brand: str):
    meta = ['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact']
    if brand: meta += ['-metadata', f'artist={brand}', '-metadata', f'comment={brand}']
    run(['ffmpeg', '-y', '-v', 'error', '-i', str(wav), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ac', '1', '-ar', '44100', '-b:a', '192k', *meta, str(out)])


def seconds(p: Path) -> float:
    try: return round(float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', str(p)]).strip()), 2)
    except Exception: return 0.0  # noqa: BLE001


def run_job(jid: str):
    job = JOBS[jid]; P = job['payload']; lang = P['lang']; scenes = P['scenes']; gender = P.get('gender') or 'female'; brand = str(P.get('brand') or '')[:80]
    pad = int(P.get('pad') or (3 if len(scenes) > 99 else 2)); skip = {int(x) for x in (P.get('skip') or [])}
    out = WORK / 'out' / jid; tmp = WORK / jid / 'tmp'; out.mkdir(parents=True, exist_ok=True); tmp.mkdir(parents=True, exist_ok=True)
    job.update(status='RUNNING', stage='Base speech')
    todo = [i for i in range(len(scenes)) if (i + 1) not in skip]
    try:
        # stage 1: every base scene, TTS model loaded once, then unloaded before Seed-VC starts
        base: dict[int, Path] = {}
        for n, i in enumerate(todo):
            if job.get('cancel'): raise Cancelled()
            b = tmp / f'base_{i + 1:04d}.wav'; job['tts'] = base_speech(scenes[i], lang, gender, b); base[i] = b
            job['progress'] = round(100 * (n + 1) / max(1, len(todo)) * 0.35, 1); job['stage'] = f'Base speech {n + 1}/{len(todo)} ({job["tts"]})'
        unload()
        # stage 2: Seed-VC, one scene at a time (own process => VRAM is freed after each scene)
        voice = Path(job['sig'])
        for n, i in enumerate(todo):
            if job.get('cancel'): raise Cancelled()
            job['stage'] = f'Signature Voice {n + 1}/{len(todo)} (Seed-VC)'
            wav = convert(base[i], voice, tmp / f's{i + 1}')
            name = f'{i + 1:0{pad}d}.mp3'; to_mp3(wav, out / name, brand)
            shutil.rmtree(tmp / f's{i + 1}', ignore_errors=True); base[i].unlink(missing_ok=True)
            sec = seconds(out / name); job['durations'][i] = sec
            job['images'].append({'index': i + 1, 'name': name, 'seconds': sec}); job['done'] = len(skip) + n + 1
            job['progress'] = round(35 + 65 * (n + 1) / max(1, len(todo)), 1)
        job.update(status='DONE', stage='Done', progress=100.0, done=len(scenes))
    except Cancelled: job.update(status='CANCELLED', stage='Cancelled')
    except Exception as e: job.update(status='FAILED', stage='Failed', error=str(e)[:500]); log('job failed', str(e)[:300])  # noqa: BLE001
    finally:
        unload(); shutil.rmtree(WORK / jid / 'tmp', ignore_errors=True)         # raw base speech / intermediates are always removed


def _worker():
    while True:
        jid = Q.get()
        try:
            if jid in JOBS and JOBS[jid]['status'] == 'QUEUED': run_job(jid)    # looked up at call time: the Omni-Worker wraps it with the global GPU lock
        except Exception as e: log('worker', str(e)[:200])  # noqa: BLE001
        finally: Q.task_done()


def register(app, public_url=lambda: ''):
    from fastapi import File, Form, HTTPException, UploadFile
    from fastapi.responses import FileResponse
    threading.Thread(target=_worker, daemon=True).start()

    @app.post('/api/clone')
    async def clone(voice: UploadFile = File(...), payload: str = Form(...)):
        try: P = json.loads(payload)
        except Exception: raise HTTPException(400, 'bad payload')  # noqa: B904
        scenes = [str(s).strip() for s in P.get('scenes', []) if str(s).strip()]
        if P.get('lang') not in ('kh', 'en'): raise HTTPException(400, 'lang must be kh or en')
        if not scenes or len(scenes) > MAX_SCENES: raise HTTPException(400, f'1..{MAX_SCENES} scenes')
        data = await voice.read()
        if not data or len(data) > MAX_SAMPLE: raise HTTPException(400, 'Signature Voice sample is empty or too big')
        jid = uuid.uuid4().hex[:12]; d = WORK / jid; d.mkdir(parents=True, exist_ok=True)
        ext = Path(voice.filename or 'v.wav').suffix.lower() or '.wav'; sig = d / f'signature{ext}'; sig.write_bytes(data)
        P['scenes'] = scenes
        JOBS[jid] = {'id': jid, 'status': 'QUEUED', 'progress': 0.0, 'stage': 'Queued', 'done': 0, 'total': len(scenes), 'images': [], 'durations': [0.0] * len(scenes), 'payload': P,
                     'sig': sig, 'created': time.time(), 'tts': None}
        Q.put(jid)
        return {'id': jid, 'total': len(scenes)}

    @app.get('/api/clone/status/{jid}')
    def status(jid: str):
        j = JOBS.get(jid)
        if not j: raise HTTPException(404, 'unknown job')
        return {'id': jid, 'status': j['status'], 'stage': j['stage'], 'progress': j['progress'], 'done': j['done'], 'total': j['total'], 'saved': j.get('saved', 0),
                'durations': j['durations'], 'tts': j.get('tts'), 'error': j.get('error'),
                'files': [{'index': x['index'], 'name': x['name'], 'url': f"{public_url()}/files/voice/{jid}/{x['name']}"} for x in j['images']]}

    @app.post('/api/clone/cancel/{jid}')
    def cancel(jid: str):
        if jid in JOBS: JOBS[jid]['cancel'] = True
        return {'ok': True}

    @app.get('/files/voice/{jid}/{name}')
    def file(jid: str, name: str):
        p = WORK / 'out' / jid / Path(name).name
        if not p.exists(): raise HTTPException(404, 'gone (already saved to Document)')
        return FileResponse(p, media_type='audio/mpeg')
