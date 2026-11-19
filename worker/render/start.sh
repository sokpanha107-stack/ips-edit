#!/usr/bin/env bash
# Atom Edit render server on a RunPod Pod (16-32 GB GPU: RTX 4000 Ada, A5000, 4090, PRO 6000...).
# Usage inside the Pod terminal:  RENDER_KEY=your-secret bash worker/render/start.sh
# Expose HTTP port 8000 on the Pod; the URL is https://<pod-id>-8000.proxy.runpod.net
set -e
cd "$(dirname "$0")"
export IPS_CACHE_DIR="${IPS_CACHE_DIR:-/workspace/.cache}"       # models + fonts survive Pod restarts when /workspace is a volume
mkdir -p "$IPS_CACHE_DIR"
export HF_HOME="${HF_HOME:-$IPS_CACHE_DIR/hf}" TORCH_HOME="${TORCH_HOME:-$IPS_CACHE_DIR/torch}"
export NVIDIA_DRIVER_CAPABILITIES="${NVIDIA_DRIVER_CAPABILITIES:-compute,utility,video}"
command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg fontconfig libgl1 libglib2.0-0 fonts-dejavu-core)
python - <<'PY' 2>/dev/null || pip install -q torch
import torch  # noqa: F401
PY
pip install -q -r requirements.txt
# optional: download the depth model now so the first render does not wait for it (skipped silently if offline)
python - <<'PY' || true
try:
    from huggingface_hub import snapshot_download
    snapshot_download('depth-anything/Depth-Anything-V2-Small-hf')
except Exception as e:
    print('depth model pre-download skipped:', str(e)[:120])
PY
echo "NVENC: $(ffmpeg -hide_banner -encoders 2>/dev/null | grep -c h264_nvenc) encoder(s) listed (the server tests it for real and falls back to libx264 if the GPU encoder is not usable)"
exec uvicorn main:app --host 0.0.0.0 --port 8000
