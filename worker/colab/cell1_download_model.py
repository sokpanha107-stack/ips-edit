# ===== Cell 1: Download Wan2.2 TI2V-5B (image -> video) to Google Drive. Run once. =====
import os, shutil, subprocess, sys

subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '-U', 'huggingface_hub', 'hf_transfer'], check=True)
os.environ['HF_HUB_ENABLE_HF_TRANSFER'] = '1'

from google.colab import drive
from huggingface_hub import HfApi, snapshot_download

REPO_ID = 'Wan-AI/Wan2.2-TI2V-5B-Diffusers'          # public model, Apache-2.0: no token needed
DRIVE_DIR = '/content/drive/MyDrive/IPS_Models/Wan2.2-TI2V-5B-Diffusers'
LOCAL_DIR = '/content/IPS_Models/Wan2.2-TI2V-5B-Diffusers'   # fallback when Drive is too small (lost when the session ends)

drive.mount('/content/drive')
os.makedirs(os.path.dirname(DRIVE_DIR), exist_ok=True)           # creates IPS_Models in Drive

# Optional token (Colab sidebar -> Secrets -> HF_TOKEN). Never paste a token into code.
try:
    from google.colab import userdata
    HF_TOKEN = userdata.get('HF_TOKEN')
except Exception:
    HF_TOKEN = None

def done(path): return os.path.exists(os.path.join(path, '.ips_complete'))

if done(DRIVE_DIR) or done(LOCAL_DIR):
    print('✅ Model រួចរាល់ មិនបាច់ Download ថ្មីទេ  (', DRIVE_DIR if done(DRIVE_DIR) else LOCAL_DIR, ')')
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
        print('⚠️ Drive មិនគ្រប់ទំហំ។ ទាញយកទៅ /content (ជាបណ្តោះអាសន្ន) ហើយត្រូវទាញយកម្តងទៀតរាល់ session ថ្មី។')
        print('   ដើម្បីរក្សាទុកអចិន្ត្រៃយ៍ សូមបង្កើនទំហំ Google Drive ឬប្រើ RunPod Network Volume។')
    os.makedirs(target, exist_ok=True)
    snapshot_download(REPO_ID, local_dir=target, token=HF_TOKEN, max_workers=8, ignore_patterns=['*.md', '.gitattributes'])
    open(os.path.join(target, '.ips_complete'), 'w').write(REPO_ID)
    print('✅ Download រួចរាល់៖', target)
