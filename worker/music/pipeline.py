"""Atom Edit · Music Engine pipeline: ONE stage at a time, verify its output, free the GPU, then the next.
Shared by music_api.py (Pod) and handler.py (Serverless). Signature Voice is mandatory: the AI guide vocal is never mixed."""
import gc, hashlib, json, os, re, shutil, subprocess, tempfile, time
from pathlib import Path
import numpy as np
import soundfile as sf

TARGET_SEC = 213.0   # 3:33
SR = 44100


class Cancelled(Exception): ...


def free_gpu():
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available(): torch.cuda.empty_cache()
    except Exception: pass  # noqa: BLE001


def run(cmd, cwd=None, env=None):
    p = subprocess.run(cmd, cwd=cwd, env={**os.environ, **(env or {})}, capture_output=True, text=True)
    if p.returncode != 0: raise RuntimeError(f"{Path(cmd[0]).name} failed: {(p.stderr or p.stdout)[-400:]}")
    return p.stdout


def nonempty(path: Path, what: str):
    if not path.exists() or path.stat().st_size < 1024: raise RuntimeError(f'{what} was not produced')
    return path


# ---------- stage 1: ACE-Step composition (temporary melody/timing guide only) ----------
def compose(p: dict, out: Path, seed):
    """ACE-Step text+lyrics -> full stereo mix. Its vocals are only a guide: they are removed in stage 2 and replaced in stage 3."""
    import sys
    sys.path.insert(0, os.environ.get('ACESTEP_DIR', '/opt/ACE-Step'))
    from acestep.pipeline_ace_step import ACEStepPipeline  # API of the ACE-Step repo; adjust here if you pin a newer release
    pipe = ACEStepPipeline(checkpoint_dir=os.environ.get('ACESTEP_CKPT', '/workspace/.cache/ace-step'), dtype='bfloat16', torch_compile=False, cpu_offload=True)
    tags = ', '.join(x for x in [p.get('style_prompt', ''), f"{p['bpm']} bpm" if p.get('bpm') else '', f"key {p['key']}" if p.get('key') else '',
                                  {'male': 'male vocal', 'female': 'female vocal'}.get(p.get('vocal_gender', ''), '')] if x)
    dur = float(p.get('duration_sec') or TARGET_SEC) + (6 if p.get('duration_lock', True) else 0)   # a little extra so the 3:33 cut lands on a musical tail
    pipe(prompt=tags[:1500], lyrics=p['lyrics'], audio_duration=dur, infer_step=60, guidance_scale=15.0, save_path=str(out),
         manual_seeds=str(seed) if seed is not None else None)
    del pipe; free_gpu()
    return nonempty(out, 'raw_mix.wav')


# ---------- stage 2: Demucs ----------
def separate(raw: Path, work: Path):
    run(['python', '-m', 'demucs', '--two-stems=vocals', '-n', 'htdemucs', '-o', str(work / 'demucs'), str(raw)])
    d = work / 'demucs' / 'htdemucs' / raw.stem
    inst = nonempty(d / 'no_vocals.wav', 'instrumental.wav'); guide = nonempty(d / 'vocals.wav', 'temp_guide_vocal.wav')
    shutil.move(str(inst), work / 'instrumental.wav'); shutil.move(str(guide), work / 'temp_guide_vocal.wav')
    free_gpu()
    return work / 'instrumental.wav', work / 'temp_guide_vocal.wav'


_SV_FLAGS: dict = {}
def seedvc_cmd(sv: str, args: list) -> list:
    """Builds the Seed-VC command, dropping any --flag the installed inference.py does not know (repo versions differ), so a renamed option never kills a job."""
    if sv not in _SV_FLAGS:
        try:
            h = subprocess.run(['python', 'inference.py', '--help'], cwd=sv, capture_output=True, text=True, timeout=120)
            _SV_FLAGS[sv] = set(re.findall(r'--[a-z0-9][a-z0-9-]*', (h.stdout or '') + (h.stderr or ''))) if h.returncode == 0 else set()
        except Exception: _SV_FLAGS[sv] = set()  # noqa: BLE001
    known = _SV_FLAGS[sv]; out = ['python', 'inference.py']; i = 0
    while i < len(args):
        a = args[i]
        if a.startswith('--') and known and a not in known: i += 2; continue   # unknown flag + its value
        out.append(a); i += 1
    return out


# ---------- stage 3: Signature Voice (Seed-VC for audio samples, RVC for .pth) ----------
def clone(guide: Path, voice: Path, index: Path | None, pitch: int, work: Path):
    out = work / 'signature_vocal.wav'
    if voice.suffix.lower() == '.pth':
        rvc = os.environ.get('RVC_DIR', '/opt/rvc')
        weights = Path(rvc) / 'assets' / 'weights'; weights.mkdir(parents=True, exist_ok=True)
        shutil.copy(voice, weights / voice.name)
        cmd = ['python', 'tools/infer_cli.py', '--f0up_key', str(pitch), '--input_path', str(guide), '--opt_path', str(out), '--model_name', voice.name, '--f0method', 'rmvpe', '--index_rate', '0.6', '--protect', '0.33']
        if index: cmd += ['--index_path', str(index)]
        run(cmd, cwd=rvc)
    else:
        sv = os.environ.get('SEEDVC_DIR', '/opt/seed-vc')
        run(seedvc_cmd(sv, ['--source', str(guide), '--target', str(voice), '--output', str(work / 'sv_out'), '--diffusion-steps', '30',
             '--f0-condition', 'True', '--auto-f0-adjust', 'False', '--semi-tone-shift', str(pitch), '--fp16', 'True']), cwd=sv)
        produced = sorted((work / 'sv_out').glob('*.wav'), key=lambda x: x.stat().st_mtime)
        if not produced: raise RuntimeError('Seed-VC produced no audio')
        shutil.move(str(produced[-1]), out)
    nonempty(out, 'signature_vocal.wav')
    guide.unlink(missing_ok=True)   # the AI guide vocal must never be able to reach the mix
    free_gpu()
    return out


# ---------- stage 4: mix, 3:33 lock, -14 LUFS, 320 kbps mp3 ----------
PRESETS = {  # (reverb room, wet, compressor ratio, high-shelf dB)
    'auto': (0.30, 0.16, 3.0, 1.5), 'warm': (0.40, 0.20, 2.5, -0.5), 'close': (0.12, 0.07, 3.5, 1.0), 'stadium': (0.85, 0.32, 3.0, 2.0), 'raw': (0.25, 0.10, 4.0, 0.0),
}


def _load(path: Path) -> np.ndarray:
    a, sr = sf.read(str(path), always_2d=True, dtype='float32')
    if sr != SR:
        from scipy.signal import resample_poly
        a = resample_poly(a, SR, sr, axis=0).astype('float32')
    return a if a.shape[1] == 2 else np.repeat(a[:, :1], 2, axis=1)


def master(inst: Path, vocal: Path, p: dict, out_mp3: Path, work: Path):
    import pyloudnorm as pyln
    from pedalboard import Compressor, HighpassFilter, HighShelfFilter, Limiter, Pedalboard, Reverb
    room, wet, ratio, shelf = PRESETS.get(p.get('mix_preset', 'auto'), PRESETS['auto'])
    v = _load(vocal); i = _load(inst)
    n = max(len(v), len(i)); v = np.pad(v, ((0, n - len(v)), (0, 0))); i = np.pad(i, ((0, n - len(i)), (0, 0)))
    v = Pedalboard([HighpassFilter(90), Compressor(threshold_db=-18, ratio=ratio), HighShelfFilter(7000, gain_db=shelf), Reverb(room_size=room, wet_level=wet, dry_level=0.9), Limiter(threshold_db=-2)])(v, SR)
    # auto-duck: when the voice sings the backing track dips 2.5 dB (smoothed RMS envelope)
    win = int(SR * 0.05); env = np.sqrt(np.convolve(np.mean(v ** 2, axis=1), np.ones(win) / win, mode='same'))
    sing = (env > 0.01).astype('float32'); k = int(SR * 0.25); sing = np.convolve(sing, np.ones(k) / k, mode='same')
    i = i * (1.0 - sing * (1 - 10 ** (-2.5 / 20)))[:, None]
    mix = v + i
    if p.get('duration_lock', True):
        tgt = int(float(p.get('duration_sec') or TARGET_SEC) * SR)
        mix = mix[:tgt] if len(mix) >= tgt else np.pad(mix, ((0, tgt - len(mix)), (0, 0)))
        fade = int(SR * 5); mix[-fade:] *= np.linspace(1, 0, fade, dtype='float32')[:, None]
    mix = np.clip(mix, -1, 1)
    meter = pyln.Meter(SR); loud = meter.integrated_loudness(mix)
    mix = pyln.normalize.loudness(mix, loud, -14.0)
    mix = Pedalboard([Limiter(threshold_db=-1.0)])(mix, SR)
    wav = work / 'final.wav'; sf.write(str(wav), mix, SR, subtype='PCM_24')
    run(['ffmpeg', '-y', '-i', str(wav), '-codec:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100', '-ac', '2',
         '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-id3v2_version', '3',   # white-label: no encoder / tool tags
         '-metadata', f"title={p.get('title', 'Song')}", *(['-metadata', f"artist={p['brand']}", '-metadata', f"comment={p['brand']}"] if p.get('brand') else []), str(out_mp3)])
    dur = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(out_mp3)]).strip() or 0)
    if dur < 10: raise RuntimeError('The .mp3 failed its integrity check')
    return dur


CKPT_ROOT = Path(os.environ.get('ATOM_STATE', '/workspace/.atom')) / 'ckpt'


def _ckpt_dir(p: dict, voice: Path) -> Path:
    """Stable per-song folder (same lyrics/style/seed/voice => same folder), so a crashed or restarted job continues from the last finished stage."""
    key = hashlib.sha1(json.dumps([p, voice.name, voice.stat().st_size if voice.exists() else 0], sort_keys=True, default=str).encode()).hexdigest()[:16]
    d = CKPT_ROOT / f'music_{key}'; d.mkdir(parents=True, exist_ok=True); return d


def _ckpt_gc(max_age_h: float = 24):
    try:
        for d in CKPT_ROOT.glob('music_*'):
            if time.time() - d.stat().st_mtime > max_age_h * 3600: shutil.rmtree(d, ignore_errors=True)
    except Exception: pass  # noqa: BLE001


def _ok(f: Path) -> bool:
    try: return f.exists() and f.stat().st_size > 4096
    except OSError: return False


def render(p: dict, voice: Path, index: Path | None, out_mp3: Path, report, cancelled=lambda: False):
    """report(step, percent, log). Raises on any failure. Models are always unloaded between stages.
    Checkpoints: each finished stage (raw mix, stems, signature vocal) stays on /workspace until the mp3 is made, so a retry skips what is already done."""
    _ckpt_gc()
    work = _ckpt_dir(p, voice); done = False
    try:
        seed = p.get('seed')
        def chk():
            if cancelled(): raise Cancelled()
        raw = work / 'raw_mix.wav'; inst = work / 'instrumental.wav'; guide = work / 'temp_guide_vocal.wav'; vocal = work / 'signature_vocal.wav'
        if not _ok(vocal):
            if not (_ok(inst) and _ok(guide)):
                if not _ok(raw):
                    report(3, 15, '● [3/7] ACE-Step 1.5 កំពុងតែងភ្លេង និងទំនុកច្រៀង (3:33)...'); chk()
                    raw = compose(p, raw, seed); report(3, 45, 'raw_mix.wav OK'); chk()
                else: report(3, 45, 'raw_mix.wav (checkpoint, skipped)')
                report(4, 45, '● [4/7] Demucs កំពុងបំបែកសាច់ភ្លេងសុទ្ធ និងដកសំឡេង AI ចេញ...')
                inst, guide = separate(raw, work); report(4, 60, 'stems OK'); chk()
            else: report(4, 60, 'stems (checkpoint, skipped)')
            report(5, 60, '● [5/7] កំពុងបំពាក់សំឡេង Signature របស់អ្នក ១០០% (Seed-VC / RVC)...')
            vocal = clone(guide, voice, index, int(p.get('pitch_shift') or 0), work); report(5, 80, 'signature_vocal.wav OK · AI guide vocal deleted'); chk()
        else: report(5, 80, 'signature_vocal.wav (checkpoint, skipped)')
        report(6, 80, '● [6/7] កំពុង Auto-Mix, ចាក់សោរ 3:33, Master (-14 LUFS) និងបង្កើតឯកសារ .MP3...')
        dur = master(inst, vocal, p, out_mp3, work); report(6, 92, f'mp3 OK · {dur:.1f}s'); done = True
        return dur
    finally:
        if done: shutil.rmtree(work, ignore_errors=True)   # success: temp files are removed; on failure/cancel the checkpoint stays for a retry (auto-deleted after 24 h)
        free_gpu()


def upload(signed_url: str, mp3: Path, callback_url: str, token: str) -> bool:
    """RunPod -> Supabase Storage (signed upload URL), then the lightweight JSON callback that registers the file in Document."""
    import httpx
    data = mp3.read_bytes()
    for attempt in range(3):
        try:
            r = httpx.put(signed_url, files=[('', (mp3.name, data, 'audio/mpeg'))], data={'cacheControl': '3600'}, headers={'x-upsert': 'true'}, timeout=180)
            if r.status_code < 300:
                c = httpx.post(callback_url, json={'token': token}, timeout=60)
                if c.status_code < 300: return True
        except Exception as e:  # noqa: BLE001
            print('[upload]', str(e)[:160])
        time.sleep(3 * (attempt + 1))
    return False
