"""Rebuilds worker/colab/cell2_api_server.py + IPS_Colab_Server.ipynb with the current render/render_api.py embedded.
Run:  python3 worker/build_notebook.py"""
import base64, gzip, json, re
from pathlib import Path

root = Path(__file__).parent
cell2 = root / 'colab/cell2_api_server.py'
src = (root / 'render/render_api.py').read_bytes()
blob = base64.b64encode(gzip.compress(src, 9)).decode()
chunks = '\n'.join(f"    '{blob[i:i + 100]}'" for i in range(0, len(blob), 100))
block = f'''# ---- render-begin: Timeline Editor renderer (FFmpeg + OpenCV), embedded from worker/render/render_api.py ----
import base64 as _b64, gzip as _gz
from pathlib import Path
_RENDER_SRC = (
{chunks}
)
if not TEST:
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'fonttools'], check=False)
Path('/content' if os.path.isdir('/content') else '.').joinpath('render_api.py').write_bytes(_gz.decompress(_b64.b64decode(_RENDER_SRC)))
sys.path.insert(0, '/content' if os.path.isdir('/content') else '.')
import render_api
render_api.register(app, lambda: PUBLIC_URL)
# ---- render-end ----
'''
text = cell2.read_text()
if '# ---- render-begin' in text:
    text = re.sub(r'# ---- render-begin.*?# ---- render-end ----\n', lambda m: block, text, flags=re.S)
else:
    text = text.replace("@app.get('/ping')", block + "\n@app.get('/ping')", 1)
cell2.write_text(text)
nb_path = root / 'colab/IPS_Colab_Server.ipynb'
nb = json.loads(nb_path.read_text())
nb['cells'][2]['source'] = text.splitlines(True)
nb_path.write_text(json.dumps(nb, ensure_ascii=False, indent=1))
print('ok', len(text))
