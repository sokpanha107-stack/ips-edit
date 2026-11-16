# ===== Cell 1: Download FLUX.2 klein 4B (images) to Google Drive. Run once. =====
import os, shutil, subprocess, sys

subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '-U', 'huggingface_hub', 'hf_transfer'], check=True)
os.environ['HF_HUB_ENABLE_HF_TRANSFER'] = '1'

from google.colab import drive
from huggingface_hub import HfApi, snapshot_download

REPO_ID = 'black-forest-labs/FLUX.2-klein-4B'          # Apache-2.0 model, no token needed
DRIVE_DIR = '/content/drive/MyDrive/IPS_Models/FLUX.2-klein-4B'
LOCAL_DIR = '/content/IPS_Models/FLUX.2-klein-4B'      # fallback when Drive is too small (lost when the session ends)

drive.mount('/content/drive')
os.makedirs(os.path.dirname(DRIVE_DIR), exist_ok=True)

# Optional token: Colab sidebar -> Secrets -> HF_TOKEN. Never paste a token into code.
try:
    from google.colab import userdata
    HF_TOKEN = userdata.get('HF_TOKEN')
except Exception:
    HF_TOKEN = None

def done(path): return os.path.exists(os.path.join(path, '.ips_complete'))

if done(DRIVE_DIR) or done(LOCAL_DIR):
    print('✅ Model already saved, nothing to download:', DRIVE_DIR if done(DRIVE_DIR) else LOCAL_DIR)
else:
    info = HfApi().model_info(REPO_ID, files_metadata=True, token=HF_TOKEN)
    need = sum((s.size or 0) for s in info.siblings)
    try:
        free = shutil.disk_usage('/content/drive/MyDrive').free
    except Exception:
        free = 0
    print(f'Model size: {need/1e9:.1f} GB | Drive free: {free/1e9:.1f} GB')
    target = DRIVE_DIR
    if free < need * 1.03:
        target = LOCAL_DIR
        print('⚠️ Not enough space in Google Drive. Downloading to /content (temporary): you must download again in every new session.')
        print('   To keep it permanently, free up Drive space or buy more storage, then run this cell again.')
    os.makedirs(target, exist_ok=True)
    snapshot_download(repo_id=REPO_ID, local_dir=target, token=HF_TOKEN)
    open(os.path.join(target, '.ips_complete'), 'w').write('ok')
    print('✅ Done. Saved to', target)
