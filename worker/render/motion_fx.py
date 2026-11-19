"""Atom Edit · motion-graphics helpers for the RunPod render worker (used by render_api.py).

Everything here is self-contained: no external video / audio assets are needed.
  - cache dir      /workspace/.cache on RunPod (survives Pod restarts when /workspace is a volume), else a temp dir
  - NVENC          h264_nvenc when the GPU encoder really works (tested once), libx264 otherwise
  - easing         exponential ease-out + handheld_breath / impact_shake / smooth_glide as ffmpeg expressions
  - 2.5D parallax  Depth-Anything-V2-Small depth map -> OpenCV remap frames (falls back to 2D when the model is unavailable)
  - overlays       dust_particles / light_leak / rain (numpy+OpenCV video) and film_grain / vignette (ffmpeg filters)
  - SFX            whoosh / riser / bass_hit / subtle_chime synthesised with numpy (an optional IPS_SFX_DIR can override)
  - ducking        a gain-envelope wav (musicLevel, attack, release) multiplied into the music track
  - callouts       ASS events (box + pop-in, count-up for numbers) placed on the side opposite the subject
All functions degrade gracefully: the caller wraps them in try/except so a failure never kills a render.
"""
import math, os, re, subprocess, tempfile, wave
from pathlib import Path

import numpy as np

try:
    import cv2
except Exception:  # noqa: BLE001
    cv2 = None


# ------------------------------------------------------------------ cache + hardware
def cache_dir() -> Path:
    """/workspace/.cache on RunPod (persistent volume) when /workspace exists, else a temp dir. Also points HF/torch caches there."""
    base = Path('/workspace/.cache') if Path('/workspace').is_dir() else Path(os.environ.get('IPS_RENDER_DIR', tempfile.gettempdir())) / 'ips_cache'
    base = Path(os.environ.get('IPS_CACHE_DIR', base))
    try:
        base.mkdir(parents=True, exist_ok=True)
    except OSError:
        base = Path(tempfile.gettempdir()) / 'ips_cache'; base.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('HF_HOME', str(base / 'hf'))
    os.environ.setdefault('TORCH_HOME', str(base / 'torch'))
    return base


CACHE = cache_dir()
_nvenc = {'ok': None}


def nvenc_ok(force_off: bool = False) -> bool:
    """True when ffmpeg can really encode with h264_nvenc here (tested once with a 1-frame job)."""
    if force_off or os.environ.get('IPS_NVENC', '1') == '0':
        return False
    if _nvenc['ok'] is None:
        try:
            r = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.1', '-frames:v', '1',
                                '-c:v', 'h264_nvenc', '-preset', 'p4', '-f', 'null', '-'], capture_output=True, text=True, timeout=30)
            _nvenc['ok'] = r.returncode == 0
        except Exception:  # noqa: BLE001
            _nvenc['ok'] = False
    return bool(_nvenc['ok'])


def disable_nvenc():
    _nvenc['ok'] = False


def venc(crf: int, fps: int, fast: bool = True) -> list:
    """Video encoder args: NVENC (constant-quality) when available, libx264 otherwise."""
    if nvenc_ok():
        return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', str(crf + 1), '-b:v', '0', '-pix_fmt', 'yuv420p', '-r', str(fps)]
    return ['-c:v', 'libx264', '-preset', 'veryfast' if fast else 'medium', '-crf', str(crf), '-pix_fmt', 'yuv420p', '-r', str(fps)]


def free_gpu():
    """Releases cached CUDA memory between scenes (no-op without torch / CUDA)."""
    try:
        import gc, torch
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass


# ------------------------------------------------------------------ settings
def settings(P: dict) -> dict:
    """Normalises payload.motionGraphics. Missing => everything off (old payloads render exactly as before)."""
    mg = P.get('motionGraphics')
    if not isinstance(mg, dict):
        return {'on': False, 'easing': 'linear', 'duck': None, 'sfx': False}
    d = mg.get('ducking') or {}
    duck = None
    if d.get('enabled'):
        duck = {'level': min(1.0, max(0.0, float(d.get('musicLevel', 0.15)))), 'attack': max(0.01, float(d.get('attackMs', 120)) / 1000), 'release': max(0.05, float(d.get('releaseMs', 600)) / 1000)}
    return {'on': True, 'easing': str(mg.get('easing') or 'exponential_out'), 'duck': duck, 'sfx': True}


def scene_fx(v: dict) -> dict:
    fx = v.get('fx') if isinstance(v.get('fx'), dict) else {}
    return {'depth': bool(fx.get('depth')), 'camera': str(fx.get('camera') or 'none'), 'overlay': str(fx.get('overlay') or 'none'),
            'callout': (str(fx['callout']).strip() if fx.get('callout') else ''), 'sfx': (str(fx['sfx']) if fx.get('sfx') else ''),
            'subtitleMode': str(fx.get('subtitleMode') or 'style')}


# ------------------------------------------------------------------ easing + camera (ffmpeg expressions, no commas outside functions)
def ease_expr(progress: str, easing: str) -> str:
    """progress = expression 0..1. exponential_out: fast start, long soft landing."""
    if easing == 'exponential_out':
        return f'((1-pow(2,-10*({progress})))/0.99902)'
    return f'({progress})'


def camera_offsets(camera: str, fps: int, iw_expr: str = 'iw', ih_expr: str = 'ih') -> tuple:
    """(x_extra, y_extra, min_zoom) as ffmpeg expressions in input pixels (zoompan is evaluated per output frame `on`)."""
    T = f'(on/{fps})'
    if camera == 'handheld_breath':   # slow organic sway + breathing, ~0.35% of the frame
        return (f'{iw_expr}*0.0035*(sin(2*PI*0.31*{T})+0.5*sin(2*PI*0.83*{T}+1))',
                f'{ih_expr}*0.0035*(cos(2*PI*0.27*{T}+0.7)+0.5*sin(2*PI*0.71*{T}))', 1.04)
    if camera == 'impact_shake':      # violent at the start of the scene, decays in ~1 s
        decay = f'exp(-3.2*{T})'
        return (f'{iw_expr}*0.018*{decay}*sin(2*PI*13*{T})', f'{ih_expr}*0.014*{decay}*cos(2*PI*17*{T}+0.5)', 1.06)
    if camera == 'smooth_glide':      # long, steady drift
        return (f'{iw_expr}*0.012*sin(2*PI*0.09*{T})', f'{ih_expr}*0.006*sin(2*PI*0.07*{T}+1)', 1.03)
    return ('0', '0', 1.0)


def camera_displacement(camera: str, t: float, W: int, H: int) -> tuple:
    """Same curves as camera_offsets, evaluated in Python (output-frame pixels) for the parallax renderer."""
    if camera == 'handheld_breath':
        return (W * 0.0035 * (math.sin(2 * math.pi * 0.31 * t) + 0.5 * math.sin(2 * math.pi * 0.83 * t + 1)),
                H * 0.0035 * (math.cos(2 * math.pi * 0.27 * t + 0.7) + 0.5 * math.sin(2 * math.pi * 0.71 * t)))
    if camera == 'impact_shake':
        k = math.exp(-3.2 * t)
        return W * 0.018 * k * math.sin(2 * math.pi * 13 * t), H * 0.014 * k * math.cos(2 * math.pi * 17 * t + 0.5)
    if camera == 'smooth_glide':
        return W * 0.012 * math.sin(2 * math.pi * 0.09 * t), H * 0.006 * math.sin(2 * math.pi * 0.07 * t + 1)
    return 0.0, 0.0


# ------------------------------------------------------------------ 2.5D parallax
_depth = {'pipe': None, 'failed': False}


def depth_map(bgr):
    """Relative depth 0..1 (1 = near) from Depth-Anything-V2-Small, cached under CACHE/hf. Returns None when unavailable."""
    if _depth['failed'] or cv2 is None:
        return None
    try:
        if _depth['pipe'] is None:
            import torch
            from transformers import pipeline
            dev = 0 if torch.cuda.is_available() else -1
            _depth['pipe'] = pipeline('depth-estimation', model='depth-anything/Depth-Anything-V2-Small-hf', device=dev)
        from PIL import Image
        rgb = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        out = _depth['pipe'](rgb)['depth']
        d = np.asarray(out, dtype=np.float32)
        d = d - d.min()
        d = d / (d.max() or 1.0)
        return d
    except Exception as e:  # noqa: BLE001  model missing / offline / out of memory -> 2D fallback
        print('[depth] unavailable, using 2D motion:', str(e)[:200])
        _depth['failed'] = True
        _depth['pipe'] = None
        return None
    finally:
        free_gpu()


def parallax_frames(img, depth, W, H, fps, dur, motion, amount, easing, camera, cx=0.5, cy=0.5):
    """Yields BGR frames W x H. `img` is already cropped to the output aspect; `depth` 0..1 (any size).
    Near pixels shift more than far pixels as the virtual camera sweeps, so the subject separates from the background."""
    n = max(2, int(round(dur * fps)))
    base = cv2.resize(img, (W, H), interpolation=cv2.INTER_LANCZOS4)
    dep = cv2.resize(depth, (W, H), interpolation=cv2.INTER_CUBIC)
    dep = cv2.GaussianBlur(dep, (0, 0), max(1.0, W / 360))            # soft edges => no tearing at depth borders
    gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    sweep = {'left': (-1, 0), 'right': (1, 0), 'up': (0, -1), 'down': (0, 1)}.get(motion, (1, 0))
    par = 0.028 * W                                                    # parallax amplitude (px), near vs far difference
    for k in range(n):
        u = k / (n - 1)
        e = (1 - 2 ** (-10 * u)) / 0.99902 if easing == 'exponential_out' else u
        z = 1.07 + (amount * e if motion == 'in' else amount * (1 - e) if motion == 'out' else 0.0)   # always >1 so the warp never shows borders
        s = (e * 2 - 1)
        ox, oy = camera_displacement(camera, k / fps, W, H)
        shift_x = par * s * sweep[0] if motion in ('left', 'right') else par * s * 0.6
        shift_y = par * s * sweep[1] if motion in ('up', 'down') else par * s * 0.25
        mx = (W * cx) + (gx - W * cx) / z + ox - shift_x * (dep - 0.5) * 2
        my = (H * cy) + (gy - H * cy) / z + oy - shift_y * (dep - 0.5) * 2
        yield cv2.remap(base, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


# ------------------------------------------------------------------ procedural overlays
def overlay_ranges(vis, starts, durs):
    """-> {overlay_name: [(start, end), ...]} for the additive overlays (dust/leak/rain) and the filter overlays (grain/vignette)."""
    out = {}
    for v, s, d in zip(vis, starts, durs):
        ov = scene_fx(v)['overlay']
        if ov and ov != 'none':
            out.setdefault(ov, []).append((s, s + d))
    return out


def _soft(ranges, t, fade=0.35):
    """1 inside a range, easing to 0 over `fade` seconds at both ends."""
    g = 0.0
    for a, b in ranges:
        if a - 1e-6 <= t <= b + 1e-6:
            g = max(g, min(1.0, (t - a) / fade, (b - t) / fade))
    return max(0.0, g)


def render_additive_overlays(path: Path, ranges: dict, total: float, W: int, H: int, fps: int = 24):
    """One half-resolution video holding dust_particles + light_leak + rain, black outside the scenes that asked for them.
    Blended with `screen` over the picture (black = no change). Returns the path or None when nothing is needed."""
    kinds = [k for k in ('dust_particles', 'light_leak', 'rain') if k in ranges]
    if not kinds or cv2 is None:
        return None
    w, h = max(64, W // 2 // 2 * 2), max(64, H // 2 // 2 * 2)
    rng = np.random.default_rng(7)
    n = int(math.ceil(total * fps)) + 1
    proc = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{w}x{h}', '-r', str(fps), '-i', '-',
                             '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p', str(path)], stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    # dust: soft bokeh specks drifting up with a slow twinkle
    nd = 70
    dust = np.column_stack([rng.random(nd) * w, rng.random(nd) * h, rng.random(nd) * 2 + 1.2, rng.random(nd) * 6.28, rng.random(nd) * 0.5 + 0.2])
    # rain: thin slanted streaks falling fast
    nr = 160
    rain = np.column_stack([rng.random(nr) * (w + 80), rng.random(nr) * h, rng.random(nr) * 0.6 + 0.7, rng.random(nr) * 14 + 10])
    black = np.zeros((h, w, 3), np.uint8).tobytes()
    try:
        for f in range(n):
            t = f / fps
            gd = _soft(ranges.get('dust_particles', []), t); gl = _soft(ranges.get('light_leak', []), t); gr = _soft(ranges.get('rain', []), t)
            if gd + gl + gr <= 0:
                proc.stdin.write(black); continue
            fr = np.zeros((h, w, 3), np.float32)
            if gl > 0:      # warm amber/rose blob sweeping across with a slow pulse
                cxp = (0.15 + 0.7 * ((t * 0.12) % 1.0)) * w
                yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
                r2 = ((xx - cxp) / (w * 0.55)) ** 2 + ((yy - h * 0.28) / (h * 0.45)) ** 2
                g = np.exp(-r2 * 2.2) * (0.55 + 0.25 * math.sin(t * 2.1)) * gl
                fr += g[..., None] * np.array([0.25, 0.55, 1.0], np.float32) * 255 * 0.7    # BGR: warm orange
            canvas = np.zeros((h, w, 3), np.uint8)
            if gd > 0:
                for x, y, r, ph, sp in dust:
                    px = (x + math.sin(t * 0.6 + ph) * 10) % w; py = (y - t * 14 * sp) % h
                    a = (0.45 + 0.55 * math.sin(t * 1.7 + ph) ** 2) * gd
                    cv2.circle(canvas, (int(px), int(py)), int(r), (int(255 * a), int(240 * a), int(210 * a)), -1, cv2.LINE_AA)
            if gr > 0:
                for x, y, sp, ln in rain:
                    px = (x - t * 120 * sp) % (w + 80) - 40; py = (y + t * 520 * sp) % (h + 40) - 20
                    c = int(150 * gr)
                    cv2.line(canvas, (int(px), int(py)), (int(px - ln * 0.25), int(py - ln)), (c, c, c), 1, cv2.LINE_AA)
            if gd > 0 or gr > 0:
                canvas = cv2.GaussianBlur(canvas, (0, 0), 0.8)
                fr += canvas.astype(np.float32)
            proc.stdin.write(np.clip(fr, 0, 255).astype(np.uint8).tobytes())
        proc.stdin.close()
        err = proc.stderr.read().decode('utf-8', 'ignore')
        if proc.wait() != 0:
            raise RuntimeError(err[-300:])
    except Exception:
        proc.kill(); raise
    return path


def filter_overlay_chain(cur: str, ranges: dict, W: int, H: int, tag: str = 'f') -> tuple:
    """ffmpeg filter_complex fragments for film_grain and vignette limited to their scenes. -> (fragments, last_label)."""
    frags = []
    spec = {'film_grain': 'noise=alls=16:allf=t,eq=contrast=1.02', 'vignette': 'vignette=angle=PI/3.2:mode=backward'}
    for name, flt in spec.items():
        if name not in ranges:
            continue
        en = '+'.join(f'between(t,{a:.3f},{b:.3f})' for a, b in ranges[name])
        a, b, c = f'{tag}{name}a', f'{tag}{name}b', f'{tag}{name}c'
        nxt = f'{tag}{name}o'
        frags.append(f'[{cur}]split[{a}][{b}];[{b}]{flt}[{c}];[{a}][{c}]overlay=0:0:enable=\'{en}\'[{nxt}]')
        cur = nxt
    return frags, cur


# ------------------------------------------------------------------ SFX synthesis
SR = 44100


def _norm(x, peak=0.8):
    m = float(np.max(np.abs(x))) or 1.0
    return (x / m * peak).astype(np.float32)


def synth_sfx(name: str) -> np.ndarray:
    rng = np.random.default_rng(11)
    if name == 'whoosh':       # band-passed noise whose centre frequency sweeps up then the level falls away
        n = int(SR * 0.75); t = np.linspace(0, 1, n, dtype=np.float32)
        noise = rng.standard_normal(n).astype(np.float32)
        cutoff = 0.02 + 0.30 * np.clip(np.sin(np.pi * t), 0, 1) ** 1.5           # one-pole low-pass cutoff (fraction of SR)
        lp = np.zeros(n, np.float32); y = 0.0
        for i in range(n):
            y += cutoff[i] * (noise[i] - y); lp[i] = y
        env = np.clip(np.sin(np.pi * t), 0, 1) ** 2 * (1 - 0.4 * t)
        return _norm(lp * env)
    if name == 'riser':        # rising sine + noise swell, abrupt end
        n = int(SR * 1.2); t = np.linspace(0, 1, n, dtype=np.float32)
        f = 180 * (10 ** (t * 1.0))
        tone = np.sin(2 * np.pi * np.cumsum(f) / SR)
        noise = rng.standard_normal(n).astype(np.float32) * 0.35
        env = t ** 2.2 * (1 - np.exp(-t * 60))
        return _norm((tone * 0.7 + noise) * env)
    if name == 'bass_hit':     # pitch-dropping sub sine + short click
        n = int(SR * 0.8); t = np.arange(n, dtype=np.float32) / SR
        f = 45 + 95 * np.exp(-t * 22)
        body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5.5)
        click = rng.standard_normal(n).astype(np.float32) * np.exp(-t * 180) * 0.5
        return _norm(body + click)
    # subtle_chime: two bell partials, soft attack, long decay
    n = int(SR * 1.1); t = np.arange(n, dtype=np.float32) / SR
    x = (np.sin(2 * np.pi * 1318.5 * t) * np.exp(-t * 4.2) + 0.55 * np.sin(2 * np.pi * 1975.5 * t) * np.exp(-t * 5.5) + 0.25 * np.sin(2 * np.pi * 2637 * t) * np.exp(-t * 8))
    x *= np.minimum(1.0, t / 0.004)
    return _norm(x, 0.55)


def write_wav(path: Path, x: np.ndarray, sr: int = SR):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())


def sfx_file(name: str) -> Path:
    """An external IPS_SFX_DIR/<name>.(wav|mp3|ogg) wins; otherwise the synthesised wav (cached under CACHE/sfx)."""
    ext_dir = os.environ.get('IPS_SFX_DIR')
    if ext_dir:
        for ext in ('wav', 'mp3', 'ogg', 'm4a'):
            p = Path(ext_dir) / f'{name}.{ext}'
            if p.exists():
                return p
    d = CACHE / 'sfx'; d.mkdir(parents=True, exist_ok=True)
    p = d / f'{name}.wav'
    if not p.exists():
        write_wav(p, synth_sfx(name))
    return p


# ------------------------------------------------------------------ music ducking
def duck_envelope(path: Path, voices: list, total: float, level: float, attack: float, release: float, sr: int = 8000) -> Path:
    """Gain curve for the music: 1.0 normally, `level` while a voice clip plays. Reaches `level` exactly when the voice starts
    (the dip begins `attack` seconds earlier) and climbs back over `release` seconds after the voice ends."""
    n = int(total * sr) + 1
    t = np.arange(n, dtype=np.float32) / sr
    pull = np.zeros(n, np.float32)
    for a, b in voices:
        ramp_in = np.clip((t - (a - attack)) / attack, 0, 1)          # 0 -> 1 over [a-attack, a]
        ramp_out = np.clip(1 - (t - b) / release, 0, 1)               # 1 -> 0 over [b, b+release]
        p = np.where(t <= a, ramp_in, np.where(t <= b, 1.0, ramp_out))
        pull = np.maximum(pull, p)
    g = 1 - pull * (1 - level)
    write_wav(path, g, sr)
    return path


# ------------------------------------------------------------------ callouts (ASS)
def _fmt_num(val: float, decimals: int, commas: bool) -> str:
    s = f'{val:,.{decimals}f}' if commas else f'{val:.{decimals}f}'
    return s


def callout_events(text: str, start: float, end: float, W: int, H: int, subject_x: float, ass_time) -> list:
    """Dialogue lines (style 'Callout'). Numbers count up with ease-out; text pops in. Sits on the side away from the subject."""
    text = text.replace('{', '(').replace('}', ')').replace('\n', '\\N')
    right = subject_x < 0.5
    an = 6 if right else 4
    x = int(W * (0.95 if right else 0.05)); y = int(H * 0.36)
    lead = 0.18
    start = max(0.0, start); end = max(start + 0.6, end)
    ev = []
    m = re.match(r'^(\D*?)(\d[\d,]*(?:\.\d+)?)(\D*)$', text)
    pos = f'\\an{an}\\pos({x},{y})'
    if m:
        pre, num, post = m.group(1), m.group(2), m.group(3)
        commas = ',' in num; dec = len(num.split('.')[1]) if '.' in num else 0
        target = float(num.replace(',', ''))
        steps, dur = 9, 0.9
        for i in range(steps):
            u = (i + 1) / steps; e = 1 - 2 ** (-8 * u)
            a = start + lead + dur * i / steps; b = start + lead + dur * (i + 1) / steps if i < steps - 1 else end
            shown = f'{pre}{_fmt_num(target * e if i < steps - 1 else target, dec, commas)}{post}'
            tags = f'{{{pos}\\fad(120,0)\\fscx88\\fscy88\\t(0,140,\\fscx100\\fscy100)}}' if i == 0 else f'{{{pos}}}'
            ev.append(f'Dialogue: 3,{ass_time(a)},{ass_time(b)},Callout,,0,0,0,,{tags}{shown}')
        return ev
    tags = f'{{{pos}\\fad(140,220)\\fscx70\\fscy70\\t(0,180,\\fscx108\\fscy108)\\t(180,320,\\fscx100\\fscy100)}}'
    ev.append(f'Dialogue: 3,{ass_time(start + lead)},{ass_time(end)},Callout,,0,0,0,,{tags}{text}')
    return ev


def callout_style(family: str, H: int) -> str:
    size = max(14, int(H * 0.052)); pad = max(8, int(H * 0.014))
    # BorderStyle 3 = opaque box using the outline colour: warm dark brown, ~72% opaque; \blur in events is not needed, box edges stay crisp
    return (f'Style: Callout,{family},{size},&H00FFFFFF,&H00FFFFFF,&H48122A3A,&H80000000,-1,0,0,0,100,100,0,0,3,{pad},0,6,{int(H * 0.03)},{int(H * 0.03)},{int(H * 0.03)},1\n')
