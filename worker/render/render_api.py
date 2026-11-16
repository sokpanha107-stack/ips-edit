"""IPS edit · Timeline render service (FFmpeg + OpenCV). Free, runs on Colab / any Linux box with ffmpeg.

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

WORK = Path(os.environ.get('IPS_RENDER_DIR', tempfile.gettempdir())) / 'ips_render'
OUT = WORK / 'out'
FONT_CACHE = WORK / 'fonts_cache'
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


def zoompan_filter(m: dict, d: int, W: int, H: int, fps: int, cx: float = 0.5, cy: float = 0.5) -> str:
    """zoompan expressions without commas. cx/cy = subject centre (0..1) so zooms aim at the subject, not the middle."""
    a, size = m['amount'], f'{W}x{H}'
    focus_x = f'(iw*{cx:.4f}-iw/zoom/2)'
    focus_y = f'(ih*{cy:.4f}-ih/zoom/2)'
    t = m['type']
    if t == 'in':   z, x, y = f'1+{a}*on/{d}', focus_x, focus_y
    elif t == 'out': z, x, y = f'{1 + a}-{a}*on/{d}', focus_x, focus_y
    else:
        z = f'{1 + max(a, 0.15)}'
        x, y = '(iw-iw/zoom)/2', '(ih-ih/zoom)/2'
        if t == 'left':  x = f'(iw-iw/zoom)*(1-on/{d})'
        if t == 'right': x = f'(iw-iw/zoom)*on/{d}'
        if t == 'up':    y = f'(ih-ih/zoom)*(1-on/{d})'
        if t == 'down':  y = f'(ih-ih/zoom)*on/{d}'
    # zoompan cannot read outside the picture: clamp with max/min is comma-based, so rely on zoom>=1 and focus inside the frame
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


def build_ass(subs, cap, W, H, family):
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
            f'100,100,0,0,1,{outline:.1f},{shadow:.1f},{align},{int(W * 0.06)},{int(W * 0.06)},{margin_v},1\n\n'
            '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n')
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
            if anim == 'karaoke':
                emit(layer, start, end, text_with(karaoke=True), prefix)
            elif anim == 'pop':
                for i in range(len(toks)):
                    ev_end = wt[i + 1][0] if i + 1 < len(toks) else end
                    emit(layer, wt[i][0], ev_end, text_with(visible_upto=i, pop_idx=i), prefix)
            else:
                emit(layer, start, end, text_with(), prefix)
    return head + '\n'.join(lines) + '\n'


# ------------------------------------------------------------------ ffmpeg helpers
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


def make_segment(job, i, v, src: Path, W, H, fps, reframe, master, workdir, base, span, dur=None):
    dur = max(0.2, float(dur if dur is not None else v['duration']))
    out = workdir / f'seg_{i:03d}.mp4'
    enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', str(fps), '-an']
    iw, ih, img = media_size(src, v['kind'])
    if v['kind'] == 'image':
        cx, cy, how = (0.5, 0.5, 'center')
        if reframe: cx, cy, how = detect_subject(img)
        x, y, cw, ch = cover_crop(iw, ih, W, H, cx, cy)
        m = parse_motion(v.get('prompt') or master)
        d = max(2, int(round(dur * fps)))
        # subject position inside the cropped window (for zoom focus)
        fx, fy = min(1, max(0, (cx * iw - x) / cw)), min(1, max(0, (cy * ih - y) / ch))
        chain = [f'crop={cw}:{ch}:{x}:{y}', f'scale={W * 2}:{H * 2}:flags=lanczos']
        chain.append(zoompan_filter(m, d, W, H, fps, fx if reframe else 0.5, fy if reframe else 0.5) if m['type'] != 'none'
                     else f'scale={W}:{H},fps={fps},loop=loop={d}:size=1:start=0')
        cmd = ['ffmpeg', '-y', '-v', 'error', '-i', str(src), '-vf', ','.join(chain), '-frames:v', str(d), *enc, '-progress', 'pipe:1', '-nostats', str(out)]
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
        cmd = ['ffmpeg', '-y', '-v', 'error', '-i', str(src), '-vf', vf, '-t', f'{dur:.3f}', *enc, '-progress', 'pipe:1', '-nostats', str(out)]
    run(cmd, job=job, total=dur, base=base, span=span)
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
            segs.append(make_segment(job, i, v, job['files'][v['file']], W, H, fps, bool(P.get('reframe')), P.get('masterPrompt', ''), wd, 60 * acc / total, 60 * durs[i] / total, dur=durs[i] + tds[i]))
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
            run(['ffmpeg', '-y', '-v', 'error', *ins, '-filter_complex', ';'.join(fcg), '-map', f'[{prev}]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', str(fps), '-an',
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
        vfs = []
        subs = P.get('subtitles') or []
        if subs:
            (wd / 'subs.ass').write_text(build_ass(subs, cap, W, H, family), encoding='utf-8')
            vfs.append('ass=subs.ass:fontsdir=fonts')
        wm = (P.get('watermark') or {}).get('text', '').strip()
        if wm:
            (wd / 'wm.txt').write_text(wm, encoding='utf-8')
            ff = find_font(user_font)
            vfs.append(f"drawtext=textfile=wm.txt:{'fontfile=' + ff + ':' if ff else ''}x=w*0.04:y=h*0.035:fontsize=h*0.032:fontcolor=white@0.88:shadowcolor=black@0.6:shadowx=2:shadowy=2")

        # audio
        inputs, fc, labels = ['-i', 'joined.mp4'], [], []
        n_in = 1
        for a in P.get('voices') or []:
            inputs += ['-i', str(job['files'][a['file']])]
            ms = int(max(0, float(a.get('start', 0))) * 1000)
            fc.append(f'[{n_in}:a]adelay={ms}|{ms},volume={float(a.get("volume", 1.0))}[a{n_in}]'); labels.append(f'[a{n_in}]'); n_in += 1
        mus = P.get('music')
        if mus and mus.get('file') in job['files']:
            inputs += ['-stream_loop', '-1', '-i', str(job['files'][mus['file']])]
            fc.append(f'[{n_in}:a]atrim=0:{total:.3f},volume={float(mus.get("volume", 0.25))}[a{n_in}]'); labels.append(f'[a{n_in}]'); n_in += 1
        vchain = ','.join(vfs) if vfs else 'null'
        fc.append(f'[0:v]{vchain}[v]')
        cmd = ['ffmpeg', '-y', '-v', 'error', *inputs]
        if labels:
            fc.append(f'{"".join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest,atrim=0:{total:.3f}[a]')
            cmd += ['-filter_complex', ';'.join(fc), '-map', '[v]', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k']
        else:
            cmd += ['-filter_complex', ';'.join(fc), '-map', '[v]', '-an']
        final = OUT / f'{jid}.mp4'
        cmd += ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', f'{total:.3f}', '-progress', 'pipe:1', '-nostats', str(final)]
        job['stage'] = 'Burning captions, watermark and mixing audio'
        run(cmd, cwd=wd, job=job, total=total, base=60, span=39)
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


# ------------------------------------------------------------------ FastAPI wiring
def register(app, public_url=lambda: ''):
    """Adds the /render routes (and CORS so the PWA can upload straight from the browser) to an existing FastAPI app."""
    from fastapi import Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse

    OUT.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=_worker, daemon=True).start()
    app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

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
