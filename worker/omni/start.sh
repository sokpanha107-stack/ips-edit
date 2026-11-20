#!/usr/bin/env bash
# Atom Edit Omni-Worker on ONE RunPod Pod (24 GB GPU: RTX 4090 / A5000). Image + Music + Timeline Render in one server, port 8000.
# Put this ONE line in the Pod's "Docker Command" (it runs again by itself on every restart):
#   bash -c "[ -d /workspace/ips-edit ] && git -C /workspace/ips-edit pull -q || git clone -q https://github.com/sokpanha107-stack/ips-edit /workspace/ips-edit; ATOM_KEY=your-secret bash /workspace/ips-edit/worker/omni/start.sh"
# Expose HTTP port 8000. URL = https://<pod-id>-8000.proxy.runpod.net . Use the SAME secret as the "Atom GPU Engine" API Key in the app.
# All models live once on the Network Volume (/workspace/.cache + /workspace/models): later restarts load locally in seconds.
set -e
cd "$(dirname "$0")"
export ATOM_CACHE="${ATOM_CACHE:-/workspace/.cache}"; mkdir -p "$ATOM_CACHE" /workspace/models
export IPS_CACHE_DIR="$ATOM_CACHE" HF_HOME="${HF_HOME:-$ATOM_CACHE/hf}" TORCH_HOME="${TORCH_HOME:-$ATOM_CACHE/torch}" ACESTEP_CKPT="${ACESTEP_CKPT:-$ATOM_CACHE/ace-step}"
export ACESTEP_DIR=/workspace/models/ACE-Step SEEDVC_DIR=/workspace/models/seed-vc RVC_DIR=/workspace/models/rvc
export NVIDIA_DRIVER_CAPABILITIES="${NVIDIA_DRIVER_CAPABILITIES:-compute,utility,video}" ATOM_EMBEDDED=1
command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg libsndfile1 git fontconfig libgl1 libglib2.0-0 fonts-dejavu-core)
V=/workspace/omni-venv
[ -d "$V" ] || python3 -m venv --system-site-packages "$V"      # keeps the template's torch/CUDA; everything else stays on the volume
. "$V/bin/activate"
if [ ! -f "$V/.ready" ]; then
  pip install -q -r requirements.txt
  [ -d "$ACESTEP_DIR" ] || git clone -q --depth 1 https://github.com/ace-step/ACE-Step "$ACESTEP_DIR"
  [ -d "$SEEDVC_DIR" ] || git clone -q --depth 1 https://github.com/Plachtaa/seed-vc "$SEEDVC_DIR"
  [ -d "$RVC_DIR" ] || git clone -q --depth 1 https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI "$RVC_DIR"
  pip install -q -e "$ACESTEP_DIR" || true
  pip install -q -r "$SEEDVC_DIR/requirements.txt" || true
  pip install -q -r "$RVC_DIR/requirements.txt" || true
  python - <<'PY' || true
from huggingface_hub import snapshot_download
for m in ('depth-anything/Depth-Anything-V2-Small-hf', 'black-forest-labs/FLUX.2-klein-4B'):
    try: snapshot_download(m)
    except Exception as e: print('pre-download skipped:', m, str(e)[:120])
PY
  touch "$V/.ready"
fi
exec uvicorn omni_api:app --host 0.0.0.0 --port 8000
