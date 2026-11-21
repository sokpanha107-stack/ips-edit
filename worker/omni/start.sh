#!/usr/bin/env bash
# Atom Edit Omni-Worker on ONE RunPod Pod (RTX A6000 48 GB recommended; 24 GB works too). Image + Music + Voice Clone + Timeline Render in one server, port 8000.
# Music Engine is paused unless you add ATOM_MUSIC=1 (see bottom). Voice Clone + Image + Render work without it.
# Put this ONE line in the Pod's "Docker Command" (it runs again by itself on every restart):
#   bash -c "[ -d /workspace/ips-edit ] && git -C /workspace/ips-edit pull -q || git clone -q https://github.com/sokpanha107-stack/ips-edit /workspace/ips-edit; ATOM_KEY=your-secret bash /workspace/ips-edit/worker/omni/start.sh"
# Expose HTTP port 8000. URL = https://<pod-id>-8000.proxy.runpod.net . Use the SAME secret as the "Atom GPU Engine" API Key in the app.
# All models live once on the Network Volume (/workspace/.cache + /workspace/models): later restarts load locally in seconds.
set -e
cd "$(dirname "$0")"
export ATOM_CACHE="${ATOM_CACHE:-/workspace/.cache}"; mkdir -p "$ATOM_CACHE" /workspace/models
export IPS_CACHE_DIR="$ATOM_CACHE" HF_HOME="${HF_HOME:-/workspace/models/hf_cache}" TORCH_HOME="${TORCH_HOME:-/workspace/models/torch_cache}" ACESTEP_CKPT="${ACESTEP_CKPT:-/workspace/models/ace-step}" HF_HUB_ENABLE_HF_TRANSFER=1
export ACESTEP_DIR=/workspace/models/ACE-Step SEEDVC_DIR=/workspace/models/seed-vc RVC_DIR=/workspace/models/rvc
export NVIDIA_DRIVER_CAPABILITIES="${NVIDIA_DRIVER_CAPABILITIES:-compute,utility,video}" ATOM_EMBEDDED=1
command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg libsndfile1 git fontconfig libgl1 libglib2.0-0 fonts-dejavu-core)
V=/workspace/omni-venv
[ -d "$V" ] || python3 -m venv --system-site-packages "$V"      # keeps the template's torch/CUDA; everything else stays on the volume
. "$V/bin/activate"
if [ ! -f "$V/.ready-b" ]; then
  pip install -q -r requirements.txt
  [ -d "$SEEDVC_DIR" ] || git clone -q --depth 1 https://github.com/Plachtaa/seed-vc "$SEEDVC_DIR"
  pip install -q -r "$SEEDVC_DIR/requirements.txt" || true
  touch "$V/.ready-b"
fi
# All models are fetched by ONE script into /workspace/models (no duplicates; finished models are skipped on every restart). You can also run it by hand on any cheap Pod: python3 download_models.py
python download_models.py || true
# Music Engine (ACE-Step + Demucs + RVC) is PAUSED by default: nothing is installed or downloaded for it (saves ~10 GB + install time). Enable later with ATOM_MUSIC=1 in the Docker Command, then restart the Pod.
if [ "${ATOM_MUSIC:-0}" = "1" ] && [ ! -f "$V/.music-ready" ]; then
  [ -d "$ACESTEP_DIR" ] || git clone -q --depth 1 https://github.com/ace-step/ACE-Step "$ACESTEP_DIR"
  [ -d "$RVC_DIR" ] || git clone -q --depth 1 https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI "$RVC_DIR"
  pip install -q -e "$ACESTEP_DIR" || true
  pip install -q -r "$RVC_DIR/requirements.txt" || true
  python download_models.py --only music || true
  touch "$V/.music-ready"
fi
exec uvicorn omni_api:app --host 0.0.0.0 --port 8000
