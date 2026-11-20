"""Atom Edit · Timeline render service (FFmpeg + OpenCV). Built for RunPod Pods (NVENC + cached AI models); also runs on any Linux box with ffmpeg.

POST /render            multipart: payload (JSON string) + one file per key referenced in the payload  -> {id}
GET  /render/status/{id}  -> {status: QUEUED|RUNNING|DONE|FAILED|CANCELLED, progress 0-100, stage, error, url}
POST /render/cancel/{id}
GET  /files/render/{name} -> the finished mp4 (unguessable id; no header needed)

Jobs run one at a time in a background worker thread with a queue. (Celery would need a Redis broker; for one user on
one machine an in-process queue gives the same behaviour: queued jobs, progress, cancel.)
"""
import json, math, os, queue, re, shutil, subprocess, tempfile, threading, time, traceback, urllib.request, uuid
from pathlib import Path

import numpy as np

try:
    import cv2
except Exception:  # noqa: BLE001  (render still works without OpenCV, just centred)
    cv2 = None

try:                                     # motion graphics (NVENC, depth parallax, overlays, SFX, ducking, callouts); absent => classic render
    import motion_fx as MFX
except Exception:  # noqa: BLE001
    MFX = None

WORK = Path(os.environ.get('IPS_RENDER_DIR', tempfile.gettempdir())) / 'ips_render'
OUT = WORK / 'out'
FONT_CACHE = (MFX.CACHE / 'fonts') if MFX else WORK / 'fonts_cache'   # RunPod: /workspace/.cache/fonts survives Pod restarts
FONT_URLS = {   # best-effort downloads of the premium Khmer fonts (Google Fonts repository)
    'Kantumruy Pro': 'https://raw.githubusercontent.com/google/fonts/main/ofl/kantumruypro/KantumruyPro%5Bwght%5D.ttf',
    'Suwannaphum': 'https://raw.githubusercontent.com/google/fonts/main/ofl/suwannaphum/Suwannaphum-Regular.ttf',
}
FALLBACK_FONTS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf']

TRANS = {'cut': None, 'fade': 'fade', 'dissolve': 'dissolve', 'fadeblack': 'fadeblack', 'wipe_left': 'wipeleft', 'wipe_right': 'wiperight', 'slide_left': 'slideleft', 'slide_right': 'slideright', 'zoom': 'zoomin'}
JOBS: dict = {}
Q: 'queue.Queue[str]' = queue.Queue()


# ------------------------------------------------------------------ prompt -> motion
def parse_motion(prompt: str) -> dict:
    """Turns a free-text instruction (English or Khmer keywords) into a Ken Burns move."""
    p = (prompt or '').lower().strip()
    if not p or re.search(r'\b(static|still|no motion|no zoom|freeze)\b|គ្មានចលនា|ឈរស្ងៀម', p):
        return {'type': 'none', 'amount': 0.0}
    amount = 0.22
    if re.search(r'subtle|gentle|slight|soft|តិចតួច', p): amount = 0.10
    if re.search(r'slow|cinematic|ស្រទន់|យឺត', p): amount = 0.14 if not re.search(r'fast', p) else amount
    if re.search(r'fast|quick|dramatic|strong|លឿន', p): amount = 0.40
    typ = 'in'
    if re.search(r'zoom[\s-]*out|pull[\s-]*(out|back)|ពង្រីកចេញ|ថយក្រោយ', p): typ = 'out'
    elif re.search(r'pan[\s-]*left|to the left|ឆ្វេង', p): typ = 'left'
    elif re.search(r'pan[\s-]*right|to the right|ស្តាំ', p): typ = 'right'
    elif re.search(r'pan[\s-]*up|tilt[\s-]*up|ឡើងលើ', p): typ = 'up'
    elif re.search(r'pan[\s-]*down|tilt[\s-]*down|ចុះក្រោម', p): typ = 'down'
    elif re.search(r'\bleft\b', p): typ = 'left'
    elif re.search(r'\bright\b', p): typ = 'right'
    return {'type': typ, 'amount': amount}


def zoompan_filter(m: dict, d: int, W: int, H: int, fps: int, cx: float = 0.5, cy: float = 0.5, easing: str = 'linear', camera: str = 'none') -> str:
    """zoompan expressions. cx/cy = subject centre (0..1) so zooms aim at the subject, not the middle.
    easing 'exponential_out' = fast start, soft landing (default for new payloads); camera adds handheld_breath / impact_shake / smooth_glide."""
    a, size = m['amount'], f'{W}x{H}'
    E = MFX.ease_expr(f'on/{d}', easing) if MFX else f'on/{d}'
    xe, ye, zmin = MFX.camera_offsets(camera, fps) if MFX else ('0', '0', 1.0)
    focus_x = f'(iw*{cx:.4f}-iw/zoom/2)'
    focus_y = f'(ih*{cy:.4f}-ih/zoom/2)'
    t = m['type']
    zb = f'{zmin:.3f}' if zmin > 1 else '1'
    if t == 'in':   z, x, y = f'{zb}+{a}*{E}', focus_x, focus_y
    elif t == 'out': z, x, y = f'{zb}+{a}-{a}*{E}', focus_x, focus_y
    elif t == 'hold': z, x, y = zb, focus_x, focus_y                       # no move, only camera shake
    else:
        z = f'{max(zmin, 1 + max(a, 0.15)):.3f}'
        x, y = '(iw-iw/zoom)/2', '(ih-ih/zoom)/2'
        if t == 'left':  x = f'(iw-iw/zoom)*(1-{E})'
        if t == 'right': x = f'(iw-iw/zoom)*{E}'
        if t == 'up':    y = f'(ih-ih/zoom)*(1-{E})'
        if t == 'down':  y = f'(ih-ih/zoom)*{E}'
    if xe != '0': x, y = f'({x})+({xe})', f'({y})+({ye})'                  # zoompan clips x/y to the picture, so shake never exposes borders
    return f"zoompan=z='{z}':x='{x}':y='{y}':d={d}:s={size}:fps={fps}"


# ------------------------------------------------------------------ subject tracking (OpenCV, no AI model download)
_cascades = []


def _faces(gray):
    if cv2 is None: return None
    if not _cascades:
        for n in ('haarcascade_frontalface_default.xml', 'haarcascade_profileface.xml'):
            f = Path(cv2.data.haarcascades) / n
            if not f.exists(): continue
            c = cv2.CascadeClassifier(str(f))
            if not c.empty(): _cascades.append(c)
    best = None
    for c in _cascades:
        for (x, y, w, h) in c.detectMultiScale(gray, 1.1, 5, minSize=(max(24, gray.shape[1] // 30),) * 2):
            if best is None or w * h > best[2] * best[3]: best = (x, y, w, h)
    return best


def _saliency_center(gray):
    """Spectral-residual saliency (Hou & Zhang): where the eye goes. Works on illustrations where faces are not found."""
    small = cv2.resize(gray, (96, 96)).astype(np.float32) / 255.0
    f = np.fft.fft2(small)
    log_amp, phase = np.log(np.abs(f) + 1e-8), np.angle(f)
    resid = log_amp - cv2.blur(log_amp, (3, 3))
    sal = np.abs(np.fft.ifft2(np.exp(resid + 1j * phase))) ** 2
    sal = cv2.GaussianBlur(sal.astype(np.float32), (0, 0), 3)
    sal -= sal.min()
    thr = np.percentile(sal, 85)
    w = np.where(sal >= thr, sal, 0)
    if w.sum() <= 0: return 0.5, 0.5
    ys, xs = np.mgrid[0:96, 0:96]
    return float((w * xs).sum() / w.sum() / 96), float((w * ys).sum() / w.sum() / 96)


def detect_subject(bgr):
    """-> (cx, cy, method) in 0..1. Face first (character portraits), then saliency, then centre."""
    if cv2 is None or bgr is None: return 0.5, 0.5, 'center'
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    face = _faces(gray)
    if face is not None:
        x, y, fw, fh = face
        return (x + fw / 2) / w, min(1.0, (y + fh * 0.9) / h), 'face'   # a little below the face centre keeps the body in frame
    sx, sy = _saliency_center(gray)
    return sx, sy, 'saliency'


def track_video(path: Path, dur: float):
    """Samples ~2 frames/s, finds the subject in each, smooths the path. -> [(t, cx, cy)] (max 14 keys)."""
    if cv2 is None: return [(0.0, 0.5, 0.5)]
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    length = min(dur, total / fps if total else dur)
    n = int(max(2, min(14, length * 2)))
    pts = []
    for i in range(n):
        t = length * i / max(1, n - 1)
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok: continue
        cx, cy, _ = detect_subject(frame)
        pts.append([t, cx, cy])
    cap.release()
    if not pts: return [(0.0, 0.5, 0.5)]
    arr = np.array(pts)
    for col in (1, 2):   # 3-point moving average = steady, no jitter
        v = arr[:, col].copy()
        for i in range(len(v)):
            lo, hi = max(0, i - 1), min(len(v), i + 2)
            arr[i, col] = v[lo:hi].mean()
    return [tuple(map(float, r)) for r in arr]


def lerp_expr(keys, var: str, scale: float, half: float, hi: float) -> str:
    """Piecewise-linear ffmpeg expression over time t, value = clamp(key*scale - half, 0, hi). Commas are fine inside quotes."""
    vals = [(t, min(hi, max(0.0, v * scale - half))) for t, v in keys]
    if len(vals) == 1: return f'{vals[0][1]:.2f}'
    expr = f'{vals[-1][1]:.2f}'
    for i in range(len(vals) - 2, -1, -1):
        t0, v0 = vals[i]; t1, v1 = vals[i + 1]
        seg = f'{v0:.2f}+({v1 - v0:.2f})*(t-{t0:.3f})/{max(0.001, t1 - t0):.3f}'
        expr = f'if(lt(t,{t1:.3f}),{seg},{expr})'
    return expr


# ------------------------------------------------------------------ ASS captions
def ass_color(hexcolor: str, alpha: int = 0) -> str:
    h = (hexcolor or '#ffffff').lstrip('#')
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f'&H{alpha:02X}{b}{g}{r}'.upper()


def ass_time(t: float) -> str:
    t = max(0.0, t); cs = int(round(t * 100))
    return f'{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}'


def font_family_of(path: Path):
    try:
        from fontTools.ttLib import TTFont
        names = TTFont(str(path), fontNumber=0)['name']
        return (names.getDebugName(16) or names.getDebugName(1) or '').strip() or None
    except Exception:  # noqa: BLE001
        return None


def wrap_tokens(tokens, max_chars):
    """Greedy manual wrap (libass cannot break Khmer, which has no spaces). -> set of token indexes that start a new line."""
    breaks, cur = set(), 0
    for i, t in enumerate(tokens):
        n = len(t.strip()) if t.strip() else len(t)
        if cur and cur + n > max_chars:
            breaks.add(i); cur = 0
        cur += len(t)
    return breaks


def _wm_xy(cfg: dict, W: int, H: int, mw: str, mh: str, tw: str, th: str):
    """x / y expressions for the watermark element (text or logo). mw/mh = canvas width/height names, tw/th = element width/height names.
    placement 'ghost' = floating anti-crop triangle wave; 'tl' | 'tr' | 'bl' | 'br' = fixed corner. Mirrors wmPosition() in lib/client/timeline.ts."""
    short = min(W, H); k = short / 720.0
    m = short * float(cfg.get('marginPct', 3.5)) / 100
    pl = cfg.get('placement') or ('ghost' if cfg.get('style') == 'ghost' else 'tl')
    if pl in ('tl', 'tr', 'bl', 'br'):
        x = f'{m:.2f}' if pl[1] == 'l' else f'{mw}-{tw}-{m:.2f}'
        y = f'{m:.2f}' if pl[0] == 't' else f'{mh}-{th}-{m:.2f}'
        return x, y
    vx, vy = float(cfg.get('vx', 55)) * k, float(cfg.get('vy', 42)) * k
    rx, ry = f'max(1,{mw}-{tw}-{2 * m:.2f})', f'max(1,{mh}-{th}-{2 * m:.2f})'
    # triangle wave 0 -> R -> 0 :  R - abs(mod(u, 2R) - R)
    return (f"{m:.2f}+{rx}-abs(mod({vx:.4f}*t+0.12*{rx},2*({rx}))-{rx})", f"{m:.2f}+{ry}-abs(mod({vy:.4f}*t+0.33*{ry},2*({ry}))-{ry})")


def watermark_filter(cfg: dict, W: int, H: int, fontfile: str | None) -> str:
    """White-label text watermark as ONE drawtext filter (no extra passes, NVENC-friendly).
    Size = sizePct of the shorter side (default 2.5%), white@opacity (default 0.28) + black@0.35 1px shadow.
    placement: 'ghost' (triangle-wave bounce) or a fixed corner. A payload without placement/style (older client) keeps the legacy top-left mark."""
    ff = f'fontfile={fontfile}:' if fontfile else ''
    if not cfg.get('placement') and cfg.get('style') != 'ghost':
        return f'drawtext=textfile=wm.txt:{ff}x=w*0.04:y=h*0.035:fontsize=h*0.032:fontcolor=white@0.88:shadowcolor=black@0.6:shadowx=2:shadowy=2'
    short = min(W, H)
    size = max(8, round(short * float(cfg.get('sizePct', 2.5)) / 100))
    op, sop = float(cfg.get('opacity', 0.28)), float(cfg.get('shadowOpacity', 0.35))
    x, y = _wm_xy(cfg, W, H, 'w', 'h', 'text_w', 'text_h')
    return f"drawtext=textfile=wm.txt:{ff}fontsize={size}:fontcolor=white@{op}:shadowcolor=black@{sop}:shadowx=1:shadowy=1:x='{x}':y='{y}'"


def logo_overlay(cfg: dict, W: int, H: int, idx: int, src: str, dst: str) -> str:
    """filter_complex fragment: scales the custom PNG logo to ~sizePct*2.4 of the short side (alpha kept), applies opacity and overlays it
    on [src] -> [dst] at the same placement rules as the text."""
    short = min(W, H)
    lh = max(12, round(short * float(cfg.get('sizePct', 2.5)) * 2.4 / 100))
    op = max(0.05, min(1.0, float(cfg.get('opacity', 0.28)) + (0.0 if cfg.get('placement') else 0.6)))
    x, y = _wm_xy(cfg, W, H, 'main_w', 'main_h', 'overlay_w', 'overlay_h')
    return f"[{idx}:v]scale=-2:{lh},format=rgba,colorchannelmixer=aa={op}[lg];[{src}][lg]overlay=x='{x}':y='{y}':format=auto[{dst}]"


def build_ass(subs, cap, W, H, family, callouts=None):
    size = max(10, int(round(H * float(cap.get('size', 5.5)) / 100)))
    outline = float(cap.get('outlineWidth', 3)) * H / 720
    shadow = float(cap.get('shadow', 0)) * H / 720
    align = {'top': 8, 'center': 5}.get(cap.get('position'), 2)
    margin_v = int(H * (0.12 if align == 2 else 0.1))
    bold = -1 if cap.get('bold', True) else 0
    anim = cap.get('anim', 'none')
    base, hi = cap.get('color', '#ffffff'), cap.get('highlight', '#ffd400')
    primary, secondary = (hi, base) if anim == 'karaoke' else (base, base)
    head = (f'[Script Info]\nScriptType: v4.00+\nPlayResX: {W}\nPlayResY: {H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n'
            '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, '
            'ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
            f'Style: Default,{family},{size},{ass_color(primary)},{ass_color(secondary)},{ass_color(cap.get("outline", "#000000"))},&H80000000,{bold},0,0,0,'
            f'100,100,0,0,1,{outline:.1f},{shadow:.1f},{align},{int(W * 0.06)},{int(W * 0.06)},{margin_v},1\n'
            '@@CALLOUT@@'
            '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n')
    if callouts and MFX: head = head.replace('@@CALLOUT@@', MFX.callout_style(family, H) + '\n')
    else: head = head.replace('@@CALLOUT@@', '\n')
    max_chars = max(6, int((W * 0.88) / (size * 0.62)))
    glow = float(cap.get('glow', 0))
    lines = []

    def emit(layer, start, end, text, prefix=''):
        lines.append(f'Dialogue: {layer},{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{prefix}{text}')

    for s in subs:
        start, end = float(s['start']), float(s['end'])
        if end <= start: continue
        toks = [str(w) for w in (s.get('words') or [])] or [str(s.get('text', ''))]
        wt = s.get('wordTimes') or []
        if len(wt) != len(toks):   # distribute by length over the scene (same idea as pairing the script with the voice)
            tot = sum(max(1, len(t.strip())) for t in toks) or 1
            acc, wt = start, []
            for t in toks:
                d = (end - start) * max(1, len(t.strip())) / tot
                wt.append([acc, acc + d]); acc += d
        br = wrap_tokens(toks, max_chars)
        layers = [(0, f'{{\\bord{outline + glow * 2:.1f}\\3c{ass_color(cap.get("glowColor", "#ffd400"))}\\3a&H70&\\blur{max(2, glow):.0f}\\shad0}}')] if glow > 0 else []
        layers.append((1, ''))
        for layer, prefix in layers:
            def text_with(visible_upto=None, karaoke=False, pop_idx=None):
                out = []
                for i, t in enumerate(toks):
                    if i in br: out.append('\\N'); t = t.lstrip()
                    seg = t.replace('{', '(').replace('}', ')')
                    if karaoke:
                        out.append(f'{{\\kf{max(1, int(round((wt[i][1] - wt[i][0]) * 100)))}}}{seg}')
                    elif visible_upto is not None and i > visible_upto:
                        out.append(f'{{\\alpha&HFF&}}{seg}{{\\alpha&H00&}}')
                    elif pop_idx == i:
                        out.append(f'{{\\fscx60\\fscy60\\t(0,140,\\fscx112\\fscy112)\\t(140,260,\\fscx100\\fscy100)}}{seg}{{\\fscx100\\fscy100}}')
                    else:
                        out.append(seg)
                return ''.join(out)
            mode = s.get('mode')
            if mode == 'line':
                # 1-Line: every line is shown on its own, its words appear one by one from left to right (layout stays fixed: unread words are transparent)
                lines_idx, cur_l = [], []
                for i in range(len(toks)):
                    if i in br and cur_l: lines_idx.append(cur_l); cur_l = []
                    cur_l.append(i)
                if cur_l: lines_idx.append(cur_l)
                for li, idxs in enumerate(lines_idx):
                    line_end = wt[lines_idx[li + 1][0]][0] if li + 1 < len(lines_idx) else end
                    for pos, j in enumerate(idxs):
                        ev_end = wt[idxs[pos + 1]][0] if pos + 1 < len(idxs) else line_end
                        txt = ''.join((f'{{\\alpha&HFF&}}{toks[q].replace("{", "(").replace("}", ")")}{{\\alpha&H00&}}' if q > j else toks[q].replace('{', '(').replace('}', ')')) for q in idxs)
                        emit(layer, wt[j][0], max(ev_end, wt[j][0] + 0.02), txt.lstrip(), prefix)
            elif mode == 'block':
                # Full Block: the whole paragraph pops up, then the current word is highlighted and pops
                hi_bgr = ass_color(hi)[4:]
                for j in range(len(toks)):
                    ev_end = wt[j + 1][0] if j + 1 < len(toks) else end
                    parts = []
                    for i, t in enumerate(toks):
                        if i in br: parts.append('\\N'); t = t.lstrip()
                        seg = t.replace('{', '(').replace('}', ')')
                        if i == j:
                            pop = '' if j == 0 else '\\fscx118\\fscy118\\t(0,140,\\fscx100\\fscy100)'
                            parts.append(f'{{\\1c&H{hi_bgr}&{pop}}}{seg}{{\\1c&H{ass_color(base)[4:]}&\\fscx100\\fscy100}}')
                        else: parts.append(seg)
                    pre = '{\\fad(90,0)\\fscx86\\fscy86\\t(0,170,\\fscx100\\fscy100)}' if j == 0 else ''
                    emit(layer, wt[j][0] if j else start, max(ev_end, wt[j][0] + 0.02), ''.join(parts), prefix + pre)
            elif anim == 'karaoke':
                emit(layer, start, end, text_with(karaoke=True), prefix)
            elif anim == 'pop':
                for i in range(len(toks)):
                    ev_end = wt[i + 1][0] if i + 1 < len(toks) else end
                    emit(layer, wt[i][0], ev_end, text_with(visible_upto=i, pop_idx=i), prefix)
            else:
                emit(layer, start, end, text_with(), prefix)
    if callouts and MFX:
        for (txt, a, b, sx) in callouts:
            lines += MFX.callout_events(txt, a, b, W, H, sx, ass_time)
    return head + '\n'.join(lines) + '\n'


# ------------------------------------------------------------------ ffmpeg helpers
def venc(crf: int, fps: int, fast: bool = True) -> list:
    """h264_nvenc when the GPU encoder works, libx264 otherwise."""
    if MFX: return MFX.venc(crf, fps, fast)
    return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', str(crf), '-pix_fmt', 'yuv420p', '-r', str(fps)]


def run_enc(build, **kw):
    """Runs build() -> cmd; if the NVENC encode fails, switches to libx264 for the rest of the process and retries once."""
    try:
        return run(build(), **kw)
    except RuntimeError as e:
        if str(e) == 'cancelled' or not (MFX and MFX.nvenc_ok()): raise
        print('[render] NVENC failed, falling back to libx264:', str(e)[-160:])
        MFX.disable_nvenc()
        return run(build(), **kw)


def run(cmd, cwd=None, job=None, total=None, base=0.0, span=0.0):
    """Runs ffmpeg, streams -progress so the UI bar moves in real time."""
    proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    tail = []
    for line in proc.stdout:
        tail.append(line); tail = tail[-25:]
        if job is not None and total and line.startswith('out_time_us='):
            try: sec = int(line.split('=')[1]) / 1e6
            except ValueError: continue
            job['progress'] = round(min(99.0, base + span * min(1.0, sec / total)), 1)
        if job is not None and job.get('cancel'):
            proc.kill(); raise RuntimeError('cancelled')
    if proc.wait() != 0:
        raise RuntimeError('ffmpeg failed: ' + ''.join(tail)[-700:])


def probe_duration(path: Path) -> float:
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', str(path)], capture_output=True, text=True)
    try: return float(r.stdout.strip())
    except ValueError: return 0.0


def media_size(path: Path, kind: str):
    if kind == 'image' and cv2 is not None:
        im = cv2.imread(str(path))
        if im is not None: return im.shape[1], im.shape[0], im
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(path)], capture_output=True, text=True)
    try: w, h = [int(v) for v in r.stdout.strip().split(',')[:2]]
    except ValueError: w, h = 1280, 720
    return w, h, None


def cover_crop(iw, ih, W, H, cx, cy):
    """Largest window of the target aspect inside the source, centred on the subject. -> (x, y, w, h)"""
    ar = W / H
    cw, ch = (iw, int(round(iw / ar))) if iw / ih < ar else (int(round(ih * ar)), ih)
    cw, ch = min(iw, cw) // 2 * 2, min(ih, ch) // 2 * 2
    x = int(min(max(0, cx * iw - cw / 2), iw - cw)); y = int(min(max(0, cy * ih - ch / 2), ih - ch))
    return x, y, cw, ch


def parallax_segment(job, v, img, box, W, H, fps, dur, m, easing, camera, fxc, out, base, span):
    """2.5D depth parallax: AI depth map -> OpenCV remap frames piped into ffmpeg. Returns True, or False when the depth model is
    unavailable (the caller then renders the normal 2D exponential-ease move)."""
    x, y, cw, ch = box
    crop = img[y:y + ch, x:x + cw]
    dm = MFX.depth_map(crop)
    if dm is None: return False
    mt = m['type'] if m['type'] in ('in', 'out', 'left', 'right', 'up', 'down') else 'drift'
    amount = min(0.25, m['amount'] or 0.12)
    n = max(2, int(round(dur * fps)))
    cmd = ['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-', *venc(19, fps), '-an', str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for k, fr in enumerate(MFX.parallax_frames(crop, dm, W, H, fps, dur, mt, amount, easing, camera, fxc[0], fxc[1])):
            proc.stdin.write(fr.tobytes())
            if k % 15 == 0:
                job['progress'] = round(min(99.0, base + span * k / n), 1)
                if job.get('cancel'): proc.kill(); raise RuntimeError('cancelled')
        proc.stdin.close()
        err = proc.stderr.read().decode('utf-8', 'ignore')
        if proc.wait() != 0: raise RuntimeError(err[-300:])
        return True
    except Exception as e:  # noqa: BLE001
        proc.kill()
        if str(e) == 'cancelled': raise
        print('[parallax] failed, using 2D motion:', str(e)[-200:])
        return False
    finally:
        MFX.free_gpu()


def make_segment(job, i, v, src: Path, W, H, fps, reframe, master, workdir, base, span, dur=None, S=None):
    S = S or {'on': False, 'easing': 'linear'}
    dur = max(0.2, float(dur if dur is not None else v['duration']))
    out = workdir / f'seg_{i:03d}.mp4'
    fxs = MFX.scene_fx(v) if (MFX and S.get('on')) else {'depth': False, 'camera': 'none'}
    iw, ih, img = media_size(src, v['kind'])
    v['_subject'] = 0.5
    if v['kind'] == 'image':
        cx, cy, how = (0.5, 0.5, 'center')
        if reframe: cx, cy, how = detect_subject(img)
        x, y, cw, ch = cover_crop(iw, ih, W, H, cx, cy)
        m = parse_motion(v.get('prompt') or v.get('motion') or master)
        d = max(2, int(round(dur * fps)))
        # subject position inside the cropped window (for zoom focus)
        fx, fy = min(1, max(0, (cx * iw - x) / cw)), min(1, max(0, (cy * ih - y) / ch))
        v['_subject'] = fx if reframe else 0.5
        fc = (fx if reframe else 0.5, fy if reframe else 0.5)
        if fxs['depth'] and MFX and cv2 is not None and img is not None:
            if parallax_segment(job, v, img, (x, y, cw, ch), W, H, fps, dur, m, S['easing'], fxs['camera'], fc, out, base, span):
                v['_info'] = f'{how}/parallax-{m["type"]}'
                return out
        if m['type'] == 'none' and fxs['camera'] != 'none': m = {'type': 'hold', 'amount': 0.0}
        chain = [f'crop={cw}:{ch}:{x}:{y}', f'scale={W * 2}:{H * 2}:flags=lanczos']
        chain.append(zoompan_filter(m, d, W, H, fps, fc[0], fc[1], S['easing'], fxs['camera']) if m['type'] != 'none'
                     else f'scale={W}:{H},fps={fps},loop=loop={d}:size=1:start=0')
        build = lambda: ['ffmpeg', '-y', '-v', 'error', '-i', str(src), '-vf', ','.join(chain), '-frames:v', str(d), *venc(19, fps), '-an', '-progress', 'pipe:1', '-nostats', str(out)]
        v['_info'] = f'{how}/{m["type"]}'
    else:
        scale = max(W / iw, H / ih)
        sw, sh = int(math.ceil(iw * scale / 2) * 2), int(math.ceil(ih * scale / 2) * 2)
        if reframe and cv2 is not None:
            keys = track_video(src, dur)
            xe = lerp_expr([(t, cx) for t, cx, _ in keys], 'x', sw, W / 2, sw - W)
            ye = lerp_expr([(t, cy) for t, _, cy in keys], 'y', sh, H / 2, sh - H)
            crop = f"crop={W}:{H}:x='{xe}':y='{ye}'"
            v['_info'] = f'tracked {len(keys)} keys'
        else:
            crop = f'crop={W}:{H}'
        vf = f'scale={sw}:{sh},{crop},fps={fps},tpad=stop_mode=clone:stop_duration={dur:.3f}'
        build = lambda: ['ffmpeg', '-y', '-v', 'error', '-i', str(src), '-vf', vf, '-t', f'{dur:.3f}', *venc(19, fps), '-an', '-progress', 'pipe:1', '-nostats', str(out)]
    run_enc(build, job=job, total=dur, base=base, span=span)
    return out


def find_font(cap_font_path=None):
    for p in ([str(cap_font_path)] if cap_font_path else []) + FALLBACK_FONTS:
        if p and Path(p).exists(): return p
    r = subprocess.run(['fc-match', '-f', '%{file}', 'sans'], capture_output=True, text=True)
    return r.stdout.strip() or None


def ensure_fonts(dest: Path, wanted: str):
    """Copies cached/downloaded premium Khmer fonts into the libass fonts dir. Never fails the render."""
    FONT_CACHE.mkdir(parents=True, exist_ok=True)
    for fam, url in FONT_URLS.items():
        if fam.lower() != (wanted or '').lower(): continue
        f = FONT_CACHE / url.rsplit('/', 1)[-1].replace('%5B', '[').replace('%5D', ']')
        if not f.exists():
            try: urllib.request.urlretrieve(url, f)
            except Exception: continue   # noqa: BLE001
        shutil.copy(f, dest / f.name)


# ------------------------------------------------------------------ the job
def render_job(jid: str):
    job = JOBS[jid]; wd: Path = job['dir']
    try:
        P = job['payload']; job['status'] = 'RUNNING'
        S = MFX.settings(P) if MFX else {'on': False, 'easing': 'linear', 'duck': None, 'sfx': False}
        W, H, fps = int(P['canvas']['w']), int(P['canvas']['h']), int(P['canvas'].get('fps', 30))
        W, H = W // 2 * 2, H // 2 * 2
        vis = P['visuals']
        if not vis: raise RuntimeError('Timeline has no visual clips')
        total = sum(max(0.2, float(v['duration'])) for v in vis)
        job['stage'] = 'Preparing clips'
        # transitions: a scene that enters with an xfade is rendered `td` seconds longer, and the overlap is placed so every scene still ends on time
        durs = [max(0.2, float(v['duration'])) for v in vis]
        tds = []
        for i, v in enumerate(vis):
            name = TRANS.get(str(v.get('transition') or 'cut')) if i > 0 else None
            td = min(float(v.get('transitionDur') or 0.5), 0.45 * durs[i], 0.45 * durs[i - 1]) if name and i > 0 else 0.0
            tds.append(td if td >= 0.05 else 0.0)
        starts = [sum(durs[:i]) for i in range(len(vis))]
        segs, acc = [], 0.0
        for i, v in enumerate(vis):
            job['stage'] = f'Clip {i + 1}/{len(vis)}'
            segs.append(make_segment(job, i, v, job['files'][v['file']], W, H, fps, bool(P.get('reframe')), P.get('masterPrompt', ''), wd, 60 * acc / total, 60 * durs[i] / total, dur=durs[i] + tds[i], S=S))
            if MFX: MFX.free_gpu()
            acc += durs[i]
        # cut-only stretches are joined without re-encoding, then the stretches are cross-faded
        runs = []   # (file, nominal start of its first scene, transition into it)
        cur = []
        for i, seg in enumerate(segs):
            if i == 0 or tds[i] > 0:
                if cur: runs.append(cur)
                cur = [i]
            else: cur.append(i)
        runs.append(cur)
        run_files = []
        for k, idxs in enumerate(runs):
            if len(idxs) == 1: run_files.append(segs[idxs[0]]); continue
            (wd / f'run{k}.txt').write_text(''.join(f"file '{segs[j].name}'\n" for j in idxs))
            job['stage'] = 'Joining clips'
            run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', f'run{k}.txt', '-c', 'copy', f'run{k}.mp4'], cwd=wd)
            run_files.append(wd / f'run{k}.mp4')
        if len(run_files) == 1:
            shutil.copy(run_files[0], wd / 'joined.mp4')
        else:
            job['stage'] = 'Cross-fading scenes'
            ins, fcg = [], []
            for k, f in enumerate(run_files):
                ins += ['-i', str(f)]
                fcg.append(f'[{k}:v]settb=AVTB,setpts=PTS-STARTPTS,fps={fps},format=yuv420p[r{k}]')
            prev = 'r0'
            for k in range(1, len(runs)):
                i = runs[k][0]
                fcg.append(f"[{prev}][r{k}]xfade=transition={TRANS[str(vis[i].get('transition'))]}:duration={tds[i]:.3f}:offset={max(0.0, starts[i] - tds[i]):.3f}[x{k}]")
                prev = f'x{k}'
            run_enc(lambda: ['ffmpeg', '-y', '-v', 'error', *ins, '-filter_complex', ';'.join(fcg), '-map', f'[{prev}]', *venc(18, fps), '-an',
                 '-t', f'{total:.3f}', '-progress', 'pipe:1', '-nostats', 'joined.mp4'], cwd=wd, job=job, total=total, base=55, span=5)

        # captions -> .ass
        cap = P.get('caption') or {}
        fonts = wd / 'fonts'; fonts.mkdir(exist_ok=True)
        family, user_font = cap.get('font', 'Kantumruy Pro'), None
        if cap.get('fontFile') and cap['fontFile'] in job['files']:
            user_font = fonts / Path(job['files'][cap['fontFile']]).name
            shutil.copy(job['files'][cap['fontFile']], user_font)
            family = font_family_of(user_font) or family
        else:
            ensure_fonts(fonts, family)
        subs = P.get('subtitles') or []
        callouts = []
        if S['on'] and MFX:
            for i, v in enumerate(vis):
                c = MFX.scene_fx(v)['callout']
                if c:
                    a0 = starts[i] + 0.3
                    callouts.append((c, a0, min(starts[i] + durs[i] - 0.15, a0 + 4.0), float(v.get('_subject', 0.5))))
        if subs or callouts:
            (wd / 'subs.ass').write_text(build_ass(subs, cap, W, H, family, callouts), encoding='utf-8')
        wmc = P.get('watermark') or {}
        mark = wmc.get('mark', 'text')                                                  # 'text' | 'logo' | 'both'
        wm = (wmc.get('text', '') if wmc.get('enabled', True) and mark in ('text', 'both') else '').strip()          # OFF => nothing is drawn
        wlogo = job['files'].get(wmc.get('logoFile') or 'wmlogo') if (wmc.get('enabled', True) and mark in ('logo', 'both')) else None
        brand = str(wmc.get('brand') or '').strip()[:80]
        ff = find_font(user_font)
        if wm: (wd / 'wm.txt').write_text(wm, encoding='utf-8')

        # procedural overlays + sound effects + ducking envelope (all synthesised here, nothing is downloaded)
        ranges = MFX.overlay_ranges(vis, starts, durs) if (S['on'] and MFX) else {}
        sfx_events = []
        if S['on'] and MFX:
            for i, v in enumerate(vis):
                name = MFX.scene_fx(v)['sfx']
                if i > 0 and name in ('whoosh', 'riser', 'bass_hit', 'subtle_chime'):
                    sfx_events.append((name, max(0.0, starts[i] - tds[i])))
        voice_spans = [(float(a.get('start', 0)), float(a.get('start', 0)) + float(a.get('duration', 0))) for a in (P.get('voices') or [])]
        mus = P.get('music')

        def final_pass(safe: bool):
            vfs = []
            if subs or callouts: vfs.append('ass=subs.ass:fontsdir=fonts')
            if wm: vfs.append(watermark_filter(wmc, W, H, ff))
            inputs, fc, labels = ['-i', 'joined.mp4'], [], []
            n_in = 1
            for a in P.get('voices') or []:
                inputs += ['-i', str(job['files'][a['file']])]
                ms = int(max(0, float(a.get('start', 0))) * 1000)
                fc.append(f'[{n_in}:a]adelay={ms}|{ms},volume={float(a.get("volume", 1.0))}[a{n_in}]'); labels.append(f'[a{n_in}]'); n_in += 1
            if mus and mus.get('file') in job['files']:
                inputs += ['-stream_loop', '-1', '-i', str(job['files'][mus['file']])]
                mv = float(mus.get('volume', 0.25))
                if S['duck'] and not safe and voice_spans:
                    MFX.duck_envelope(wd / 'duck.wav', voice_spans, total, S['duck']['level'], S['duck']['attack'], S['duck']['release'])
                    fc.append(f'[{n_in}:a]atrim=0:{total:.3f},volume={mv},aresample=44100,aformat=channel_layouts=stereo[m{n_in}]')
                    inputs += ['-i', 'duck.wav']
                    fc.append(f'[{n_in + 1}:a]aresample=44100,aformat=channel_layouts=stereo[e{n_in}]')
                    fc.append(f'[m{n_in}][e{n_in}]amultiply[a{n_in}]'); labels.append(f'[a{n_in}]'); n_in += 2
                else:
                    fc.append(f'[{n_in}:a]atrim=0:{total:.3f},volume={mv}[a{n_in}]'); labels.append(f'[a{n_in}]'); n_in += 1
            if not safe:
                for name, at in sfx_events:
                    inputs += ['-i', str(MFX.sfx_file(name))]
                    ms = int(at * 1000)
                    fc.append(f'[{n_in}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={ms}|{ms},volume=0.55[a{n_in}]'); labels.append(f'[a{n_in}]'); n_in += 1
            cur = '0:v'
            if ranges and not safe:
                add = MFX.render_additive_overlays(wd / 'fxov.mp4', ranges, total, W, H)
                if add:
                    inputs += ['-i', 'fxov.mp4']
                    fc.append(f'[{n_in}:v]scale={W}:{H}:flags=bilinear,format=gbrp[ovs];[{cur}]format=gbrp[ovb];[ovb][ovs]blend=all_mode=screen:shortest=1,format=yuv420p[blend]')
                    cur = 'blend'; n_in += 1
                frags, cur = MFX.filter_overlay_chain(cur, ranges, W, H)
                fc += frags
            if wlogo:
                inputs += ['-i', str(wlogo)]
                fc.append(f'[{cur}]{",".join(vfs) if vfs else "null"}[vt]')
                fc.append(logo_overlay(wmc, W, H, n_in, 'vt', 'v')); n_in += 1
            else:
                fc.append(f'[{cur}]{",".join(vfs) if vfs else "null"}[v]')
            cmd = ['ffmpeg', '-y', '-v', 'error', *inputs]
            if labels:
                fc.append(f'{"".join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest,atrim=0:{total:.3f}[a]')
                cmd += ['-filter_complex', ';'.join(fc), '-map', '[v]', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k']
            else:
                cmd += ['-filter_complex', ';'.join(fc), '-map', '[v]', '-an']
            if safe and MFX: MFX.disable_nvenc()
            # white-label: drop every tool/worker tag; only the locked brand name (if any) is written as artist/comment
            meta = ['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact']
            if brand: meta += ['-metadata', f'artist={brand}', '-metadata', f'comment={brand}']
            cmd += [*meta, *venc(20, fps, fast=False), '-movflags', '+faststart', '-t', f'{total:.3f}', '-progress', 'pipe:1', '-nostats', str(final)]
            return cmd

        final = OUT / f'{jid}.mp4'
        job['stage'] = 'Motion graphics, captions, watermark and audio mix'
        try:
            run_enc(lambda: final_pass(False), cwd=wd, job=job, total=total, base=60, span=39)
        except RuntimeError as e:
            if str(e) == 'cancelled' or not (S['on'] and MFX): raise
            print('[render] motion-graphics pass failed, retrying plain:', str(e)[-300:])     # a broken effect must never lose the whole video
            job['stage'] = 'Retrying without effects'
            run(final_pass(True), cwd=wd, job=job, total=total, base=60, span=39)
        job.update(status='DONE', progress=100.0, stage='Done', file=final.name)
    except Exception as e:  # noqa: BLE001
        cancelled = str(e) == 'cancelled'
        job.update(status='CANCELLED' if cancelled else 'FAILED', error=None if cancelled else str(e)[-900:], stage='Cancelled' if cancelled else 'Failed')
        if not cancelled: traceback.print_exc()
    finally:
        shutil.rmtree(wd, ignore_errors=True)


def _worker():
    while True:
        jid = Q.get()
        try:
            if JOBS[jid].get('cancel'): JOBS[jid].update(status='CANCELLED', stage='Cancelled'); shutil.rmtree(JOBS[jid]['dir'], ignore_errors=True)
            else: render_job(jid)
        finally:
            Q.task_done()


# ------------------------------------------------------------------ dead-man's switch (RunPod): stop the Pod when nobody is talking to it
IDLE_TIMEOUT_SECONDS = 180                 # no API request for 3 minutes => the Pod stops itself (phone offline / app closed mid-job)
ACTIVITY_FILE = Path(os.environ.get('IPS_ACTIVITY_FILE', '/tmp/ips_last_activity'))   # shared with the Image Engine server on the same Pod
_INFLIGHT = {'n': 0}
_STARTED = time.time()


def touch_activity():
    try: ACTIVITY_FILE.touch()
    except OSError: pass


def last_activity() -> float:
    try: return max(_STARTED, ACTIVITY_FILE.stat().st_mtime)
    except OSError: return _STARTED


def stop_own_pod() -> bool:
    """Asks RunPod to stop *this* Pod (billing for the GPU ends). Uses the Pod-scoped RUNPOD_API_KEY that RunPod injects; falls back to runpodctl."""
    pod = os.environ.get('RUNPOD_POD_ID', '')
    key = os.environ.get('IPS_RUNPOD_API_KEY') or os.environ.get('RUNPOD_API_KEY', '')
    if not pod: return False
    try:
        req = urllib.request.Request(f'https://rest.runpod.io/v1/pods/{pod}/stop', method='POST', headers={'Authorization': f'Bearer {key}'})
        with urllib.request.urlopen(req, timeout=20) as r:
            if 200 <= r.status < 300: return True
    except Exception as e:  # noqa: BLE001
        print('[watchdog] REST stop failed:', str(e)[:160])
    try:
        return subprocess.run(['runpodctl', 'stop', 'pod', pod], capture_output=True, timeout=30).returncode == 0
    except Exception as e:  # noqa: BLE001
        print('[watchdog] runpodctl stop failed:', str(e)[:160])
        return False


def idle_stop_enabled() -> bool:
    """ATOM_IDLE_STOP=0 disables auto-stop. The old IPS_IDLE_STOP is still honoured as a fallback."""
    return os.environ.get('ATOM_IDLE_STOP', os.environ.get('IPS_IDLE_STOP', '1')) != '0'


def _busy() -> bool:
    """A queued or running render NEVER counts as idle, even when the phone is locked and nobody polls."""
    return any(j.get('status') in ('QUEUED', 'RUNNING') for j in list(JOBS.values()))


def _watchdog():
    """Lightweight timer thread. Only active on a RunPod Pod (RUNPOD_POD_ID set) unless ATOM_IDLE_STOP=0.
    Inside the Omni-Worker (ATOM_EMBEDDED=1) the single Omni watchdog does this job instead."""
    if os.environ.get('ATOM_EMBEDDED') == '1': return
    if not os.environ.get('RUNPOD_POD_ID') or not idle_stop_enabled():
        print('[watchdog] idle auto-stop disabled (not on a RunPod Pod, or ATOM_IDLE_STOP=0)')
        return
    print(f'[watchdog] Pod stops itself after {IDLE_TIMEOUT_SECONDS}s without API requests')
    while True:
        time.sleep(10)
        idle = time.time() - last_activity()
        if _INFLIGHT['n'] > 0 or _busy() or idle < IDLE_TIMEOUT_SECONDS: continue   # a request or a running job keeps the Pod alive
        print(f'[watchdog] idle for {int(idle)}s, stopping the Pod')
        if stop_own_pod(): return
        time.sleep(60)                                                        # could not stop: try again in a minute


# ------------------------------------------------------------------ FastAPI wiring
def register(app, public_url=lambda: ''):
    """Adds the /render routes (and CORS so the PWA can upload straight from the browser) to an existing FastAPI app."""
    from fastapi import Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse

    OUT.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=_worker, daemon=True).start()
    threading.Thread(target=_watchdog, daemon=True).start()
    touch_activity()                                                           # booting counts as activity: a fresh Pod gets the full 3 minutes
    app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

    @app.middleware('http')
    async def activity(request: Request, call_next):
        # /health and CORS preflights do not count: an app left open on the Command Center must not keep a GPU running forever
        counts = request.method != 'OPTIONS' and request.url.path != '/health'
        if counts: touch_activity(); _INFLIGHT['n'] += 1
        try: return await call_next(request)
        finally:
            if counts: _INFLIGHT['n'] -= 1; touch_activity()

    @app.post('/render')
    async def render(request: Request):
        form = await request.form()
        try: payload = json.loads(str(form.get('payload', '')))
        except ValueError: return JSONResponse({'ok': False, 'error': 'payload is not valid JSON'}, status_code=400)
        jid = uuid.uuid4().hex[:16]
        wd = WORK / jid; wd.mkdir(parents=True, exist_ok=True)
        files = {}
        for key, val in form.multi_items():
            if key == 'payload' or not hasattr(val, 'read') or not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', key): continue
            safe = re.sub(r'[^A-Za-z0-9._-]', '_', getattr(val, 'filename', '') or key)[-80:]
            dest = wd / f'{key}_{safe}'
            with open(dest, 'wb') as fh: shutil.copyfileobj(val.file, fh)
            files[key] = dest
        need = [v['file'] for v in payload.get('visuals', [])] + [a['file'] for a in payload.get('voices', [])]
        missing = [k for k in need if k not in files]
        if missing:
            shutil.rmtree(wd, ignore_errors=True)
            return JSONResponse({'ok': False, 'error': f'missing files: {", ".join(missing[:5])}'}, status_code=400)
        JOBS[jid] = {'id': jid, 'status': 'QUEUED', 'progress': 0.0, 'stage': 'Queued', 'dir': wd, 'files': files, 'payload': payload, 'created': time.time()}
        Q.put(jid)
        return {'ok': True, 'id': jid, 'queued': Q.qsize()}

    @app.get('/render/status/{jid}')
    def status(jid: str):
        j = JOBS.get(jid)
        if not j: return JSONResponse({'ok': False, 'error': 'unknown job'}, status_code=404)
        return {'ok': True, 'status': j['status'], 'progress': j['progress'], 'stage': j['stage'], 'error': j.get('error'),
                'url': f"{public_url()}/files/render/{j['file']}" if j.get('file') else None}

    @app.post('/render/cancel/{jid}')
    def cancel(jid: str):
        if jid in JOBS: JOBS[jid]['cancel'] = True
        return {'ok': True}

    @app.get('/files/render/{name}')
    def get_file(name: str):
        p = OUT / Path(name).name
        return FileResponse(p, media_type='video/mp4', filename=p.name) if p.exists() else JSONResponse({'error': 'not found'}, status_code=404)
