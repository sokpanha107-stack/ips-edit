#!/usr/bin/env python3
"""Atom Edit: pre-download ALL models for the active engines onto the RunPod Network Volume (/workspace/models).

Universal: no torch / CUDA import, so it runs on ANY Pod (even a cheap CPU Pod) that has the same volume mounted.
Active stack (default): Image (FLUX.2-klein-4B) + Voice Clone (Seed-VC speech + CAMPPlus + Whisper + BigVGAN + MMS-TTS) + 2.5D Render
(Depth-Anything-V2-Small) + Khmer fonts.  Music (ACE-Step, Demucs, Seed-VC f0/singing) only with --with-music.

  pip install -q -U huggingface_hub hf_transfer
  python3 download_models.py                 # default stack
  python3 download_models.py --with-music    # + music models (+~12 GB)
  python3 download_models.py --dry-run       # show the plan, download nothing
  python3 download_models.py --only voice,fonts --force

Layout (one copy of everything):
  /workspace/models/hf_cache/        HF_HOME  (FLUX, Depth-Anything, MMS-TTS ...)
  /workspace/models/torch_cache/     TORCH_HOME
  /workspace/models/seed-vc/         Seed-VC repo; its weights live in seed-vc/checkpoints/hf_cache (Seed-VC forces that folder)
  /workspace/models/fonts/           Khmer .ttf
  /workspace/models/.done/           one marker per finished model (re-run = resume; --force = redo)
"""
import argparse, os, re, shutil, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(os.environ.get('ATOM_MODELS', '/workspace/models'))
os.environ.setdefault('HF_HOME', str(ROOT / 'hf_cache'))
os.environ.setdefault('TORCH_HOME', str(ROOT / 'torch_cache'))
os.environ.setdefault('HF_HUB_ENABLE_HF_TRANSFER', '1')
try:
    import hf_transfer  # noqa: F401
except ImportError:
    os.environ['HF_HUB_ENABLE_HF_TRANSFER'] = '0'
    print('note: hf_transfer not installed -> normal (slower) download. Install: pip install hf_transfer')
try:
    from huggingface_hub import hf_hub_download, snapshot_download
except ImportError:
    sys.exit('huggingface_hub is missing. Run: pip install -q -U huggingface_hub hf_transfer')

TOKEN = os.environ.get('HF_TOKEN') or os.environ.get('HUGGING_FACE_HUB_TOKEN') or None
DONE = ROOT / '.done'
SEEDVC_DIR = Path(os.environ.get('SEEDVC_DIR', str(ROOT / 'seed-vc')))
SV_CACHE = SEEDVC_DIR / 'checkpoints' / 'hf_cache'       # Seed-VC sets HF_HUB_CACHE='./checkpoints/hf_cache' itself, so weights must be here
FONT_DIR = Path(os.environ.get('ATOM_FONTS_DIR', str(ROOT / 'fonts')))
ACESTEP_CKPT = Path(os.environ.get('ACESTEP_CKPT', str(ROOT / 'ace-step')))
JUNK = ['*.md', '.gitattributes', '*.msgpack', '*.h5', '*.ot', '*.onnx', '*.tflite', 'flax_model*', 'tf_model*',
        'assets/*', 'examples/*', '*.png', '*.jpg', '*.jpeg', '*.gif', '*.mp4', '*.mp3', '*.wav']
FAILED: list = []
ARGS = None


def log(*a): print(*a, flush=True)
def gb(n): return f'{n / 1e9:.2f} GB'


def dir_size(p: Path) -> int:
    t = 0
    for f in p.rglob('*'):
        try:
            if f.is_file() and not f.is_symlink(): t += f.stat().st_size      # blobs only: symlinks into the cache are not counted twice
        except OSError: pass
    return t


def has_weights(path: str) -> bool:
    p = Path(path)
    return any(p.rglob('*.safetensors')) or any(p.rglob('*.bin')) or any(p.rglob('*.pt')) or any(p.rglob('*.pth'))


def explain(repo: str, e: Exception):
    m = str(e)
    if type(e).__name__ == 'GatedRepoError' or any(k in m.lower() for k in ('gated', 'access to model', '401 client error')):
        log(f'  !! {repo} needs a Hugging Face login/licence. Accept the licence on its page, then:  export HF_TOKEN=hf_xxx  and run again.')
    else:
        log(f'  !! {repo}: {m[:300]}')


def snap(repo: str, ignore_tiers, allow=None, cache_dir=None, need_weights=True) -> str:
    """snapshot_download that tries ignore-tiers in order (strict first) until real weight files are present."""
    last = None
    for ign in ignore_tiers:
        try:
            path = snapshot_download(repo_id=repo, token=TOKEN, allow_patterns=allow, ignore_patterns=ign, cache_dir=cache_dir, max_workers=8)
            if not need_weights or has_weights(path): return path
            log(f'  .. {repo}: no weight file with these filters, retrying with looser filters')
        except Exception as e:  # noqa: BLE001
            last = e
            if type(e).__name__ == 'GatedRepoError' or 'gated' in str(e).lower(): break
    raise last or RuntimeError(f'{repo}: no weights found')


def job(name, fn):
    marker = DONE / f'{name}.done'
    if marker.exists() and not ARGS.force:
        log(f'[skip] {name} (already done; use --force to redo)'); return
    log(f'[start] {name}'); t = time.time()
    if ARGS.dry_run:
        log('  (dry run)'); return
    try:
        fn(); DONE.mkdir(parents=True, exist_ok=True); marker.write_text(time.strftime('%Y-%m-%d %H:%M:%S'))
        log(f'[done] {name} in {time.time() - t:.0f}s')
    except Exception as e:  # noqa: BLE001
        FAILED.append(name); explain(name, e)


# ---------------------------------------------------------------- Image
def get_flux():
    p = snap('black-forest-labs/FLUX.2-klein-4B', [JUNK + ['flux-2-klein-4b*.safetensors']])   # root single-file = 7.75 GB duplicate of transformer/
    if not (Path(p) / 'model_index.json').exists(): raise RuntimeError('FLUX download incomplete (model_index.json missing)')


# ---------------------------------------------------------------- Seed-VC
def ensure_seedvc_repo():
    if (SEEDVC_DIR / 'inference.py').exists(): return
    if SEEDVC_DIR.exists() and any(SEEDVC_DIR.iterdir()): raise RuntimeError(f'{SEEDVC_DIR} exists but has no inference.py; delete that folder and re-run')
    if not shutil.which('git'): raise RuntimeError('git is missing: apt-get update && apt-get install -y git')
    SEEDVC_DIR.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['git', 'clone', '-q', '--depth', '1', 'https://github.com/Plachtaa/seed-vc', str(SEEDVC_DIR)], check=True)


def cfg_repos(cfg_file: str, defaults):
    """Whisper / BigVGAN repo ids are named inside the Seed-VC yaml; read them so we always fetch exactly what inference.py will ask for."""
    txt = Path(cfg_file).read_text(errors='ignore')
    found = re.findall(r'^\s*(?:name|model_name)\s*:\s*["\']?([A-Za-z0-9][A-Za-z0-9_.\-]*/[A-Za-z0-9_.\-]+)["\']?\s*$', txt, re.M)
    if not found:
        log(f'  note: no repo ids found in the yaml, using defaults {defaults}'); found = list(defaults)
    return found


def get_helper(repo: str):
    if 'bigvgan' in repo.lower():
        snapshot_download(repo_id=repo, token=TOKEN, allow_patterns=['config.json', 'bigvgan_generator.pt'], cache_dir=str(SV_CACHE))   # skips 2.9 GB of discriminator/optimizer files
    else:
        snap(repo, [JUNK + ['pytorch_model.bin'], JUNK], cache_dir=str(SV_CACHE))


def seedvc_weights(files, defaults, rmvpe=False):
    ensure_seedvc_repo(); SV_CACHE.mkdir(parents=True, exist_ok=True)
    got = {f: hf_hub_download('Plachta/Seed-VC', f, token=TOKEN, cache_dir=str(SV_CACHE)) for f in files}
    hf_hub_download('funasr/campplus', 'campplus_cn_common.bin', token=TOKEN, cache_dir=str(SV_CACHE))
    if rmvpe: hf_hub_download('lj1995/VoiceConversionWebUI', 'rmvpe.pt', token=TOKEN, cache_dir=str(SV_CACHE))
    for r in cfg_repos(got[files[1]], defaults): get_helper(r)


def get_seedvc_speech():   # the exact files inference.py loads when --f0-condition False (Voice Clone)
    seedvc_weights(['DiT_seed_v2_uvit_whisper_small_wavenet_bigvgan_pruned.pth', 'config_dit_mel_seed_uvit_whisper_small_wavenet.yml'],
                   ['openai/whisper-small', 'nvidia/bigvgan_v2_22khz_80band_256x'])


def get_seedvc_f0():       # --f0-condition True (singing, Music Engine)
    seedvc_weights(['DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth', 'config_dit_mel_seed_uvit_whisper_base_f0_44k.yml'],
                   ['openai/whisper-base', 'nvidia/bigvgan_v2_44khz_128band_512x'], rmvpe=True)


def get_mms():
    for r in ('facebook/mms-tts-khm', 'facebook/mms-tts-eng'): snap(r, [JUNK + ['*.bin'], JUNK])   # prefer safetensors, fall back to .bin


# ---------------------------------------------------------------- Render + fonts
def get_depth(): snap('depth-anything/Depth-Anything-V2-Small-hf', [JUNK + ['*.bin'], JUNK])


FONTS = {   # same Google Fonts files the renderer uses (+ Noto Sans Khmer)
    'KantumruyPro[wght].ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/kantumruypro/KantumruyPro%5Bwght%5D.ttf',
    'Suwannaphum-Regular.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/suwannaphum/Suwannaphum-Regular.ttf',
    'NotoSansKhmer[wdth,wght].ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskhmer/NotoSansKhmer%5Bwdth%2Cwght%5D.ttf',
}


def get_fonts():
    FONT_DIR.mkdir(parents=True, exist_ok=True); ok = 0
    for name, url in FONTS.items():
        f = FONT_DIR / urllib.parse.unquote(name)
        if f.exists() and f.stat().st_size > 50_000: ok += 1; continue
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'atom-edit'}), timeout=60).read()
            if data[:4] not in (b'\x00\x01\x00\x00', b'OTTO', b'true', b'ttcf'): raise RuntimeError('not a font file')
            f.write_bytes(data); ok += 1
        except Exception as e: log(f'  !! font {name}: {e}')  # noqa: BLE001
    if ok == 0: raise RuntimeError('no font could be downloaded')


# ---------------------------------------------------------------- Music (only with --with-music)
def get_acestep():
    ACESTEP_CKPT.mkdir(parents=True, exist_ok=True)
    snapshot_download(repo_id='ACE-Step/ACE-Step-v1-3.5B', token=TOKEN, local_dir=str(ACESTEP_CKPT), ignore_patterns=JUNK, max_workers=8)


def get_demucs():   # htdemucs checkpoint where torch.hub looks for it (TORCH_HOME), so Demucs never re-downloads
    dst = Path(os.environ['TORCH_HOME']) / 'hub' / 'checkpoints'; dst.mkdir(parents=True, exist_ok=True)
    f = dst / '955717e8-8726e21a.th'
    if f.exists() and f.stat().st_size > 10_000_000: return
    urllib.request.urlretrieve('https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th', f)


GROUPS = {
    'image': [('flux-klein-4b', get_flux)],
    'voice': [('seedvc-speech', get_seedvc_speech), ('mms-tts', get_mms)],
    'render': [('depth-anything-v2-small', get_depth)],
    'fonts': [('khmer-fonts', get_fonts)],
    'music': [('acestep-v1-3.5b', get_acestep), ('demucs-htdemucs', get_demucs), ('seedvc-f0', get_seedvc_f0)],
}


def summary():
    log('\n================ disk usage ================')
    ROOT.mkdir(parents=True, exist_ok=True)
    try: log(subprocess.run(['du', '-sh', str(ROOT)], capture_output=True, text=True).stdout.strip())
    except Exception: log(f'{ROOT}: {gb(dir_size(ROOT))}')  # noqa: BLE001
    for p in sorted(ROOT.iterdir()) if ROOT.exists() else []:
        if p.name == '.done': continue
        log(f'  {p.name:<14}{gb(dir_size(p))}')
    try:
        u = shutil.disk_usage(ROOT); log(f'volume: {gb(u.used)} used / {gb(u.total)} total, {gb(u.free)} free (jobs need >= 10 GB free)')
    except OSError: pass


def main():
    global ARGS
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--with-music', action='store_true', help='also ACE-Step, Demucs, Seed-VC f0 (singing)')
    ap.add_argument('--only', default='', help='comma list: image,voice,render,fonts,music')
    ap.add_argument('--no-mms', action='store_true', help='skip MMS-TTS (self-hosted Khmer/English base voice)')
    ap.add_argument('--force', action='store_true', help='ignore .done markers')
    ap.add_argument('--dry-run', action='store_true')
    ARGS = ap.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    try:
        free = shutil.disk_usage(ROOT).free
        if free < 30e9 and not ARGS.dry_run: log(f'WARNING: only {gb(free)} free on {ROOT}; the default stack needs ~25 GB')
    except OSError: pass
    want = [g.strip() for g in ARGS.only.split(',') if g.strip()] or ['image', 'voice', 'render', 'fonts'] + (['music'] if ARGS.with_music else [])
    log(f'models dir: {ROOT}\nHF_HOME={os.environ["HF_HOME"]}\nhf_transfer={os.environ["HF_HUB_ENABLE_HF_TRANSFER"]}  HF_TOKEN={"set" if TOKEN else "not set (only needed for gated repos)"}\nplan: {", ".join(want)}\n')
    for g in want:
        for name, fn in GROUPS.get(g, []):
            if name == 'mms-tts' and ARGS.no_mms: continue
            job(name, fn)
    summary()
    if FAILED:
        log(f'\nFAILED: {", ".join(FAILED)}  (fix the message above and run the same command again; finished models are skipped)'); sys.exit(1)
    log('\nAll requested models are on the volume.')


if __name__ == '__main__':
    main()
