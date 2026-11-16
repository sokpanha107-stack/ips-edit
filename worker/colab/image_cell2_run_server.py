# ===== Cell 2: Get the code from GitHub + start the Image Engine. Run every session; keep it running. =====
import os, subprocess

REPO = 'https://github.com/sokpanha107-stack/ips-edit.git'
DIR = '/content/ips-edit'
if os.path.isdir(DIR + '/.git'):
    subprocess.run(['git', '-C', DIR, 'pull', '--ff-only'], check=True)        # newest code every time
else:
    subprocess.run(['git', 'clone', '--depth', '1', REPO, DIR], check=True)

# libraries (FLUX.2 klein needs the newest diffusers, installed from GitHub)
subprocess.run('pip install -q fastapi uvicorn python-multipart pillow accelerate transformers sentencepiece protobuf', shell=True, check=True)
subprocess.run('pip install -q -U git+https://github.com/huggingface/diffusers.git', shell=True, check=True)

from google.colab import drive
drive.mount('/content/drive')                      # so the model saved by Cell 1 can be read
os.environ['IPS_IMAGE_MODEL'] = 'klein'            # 'klein' = FLUX.2 klein 4B  |  'sdxl' = SDXL + IP-Adapter

# Starts the server and prints the API URL + KEY (this cell keeps running)
proc = subprocess.Popen(['python', '-u', DIR + '/worker/image/colab_server.py'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=os.environ.copy())
for line in proc.stdout:                           # show the server's messages in this cell
    print(line, end='')
