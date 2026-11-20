#!/usr/bin/env bash
# Atom Edit Music Engine on a RunPod Pod: PLUG & PLAY. Models + packages live on the Pod's /workspace disk (never in the app).
# Put this ONE line in the Pod's "Docker Command" (or run it once in the Pod terminal); it runs again by itself every time the Pod (re)starts:
#   bash -c "[ -d /workspace/ips-edit ] && git -C /workspace/ips-edit pull -q || git clone -q https://github.com/sokpanha107-stack/ips-edit /workspace/ips-edit; MUSIC_KEY=your-secret bash /workspace/ips-edit/worker/music/start.sh"
# Expose HTTP port 8000. URL = https://<pod-id>-8000.proxy.runpod.net
# First start installs + downloads models (slow, once). Every later start reuses /workspace and is ready in about a minute.
set -e
cd "$(dirname "$0")"
M=/workspace/models; V=/workspace/music-venv; mkdir -p "$M"
export HF_HOME="${HF_HOME:-/workspace/.cache/hf}" TORCH_HOME="${TORCH_HOME:-/workspace/.cache/torch}"
export ACESTEP_DIR="$M/ACE-Step" SEEDVC_DIR="$M/seed-vc" RVC_DIR="$M/rvc"
command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg libsndfile1 git)
[ -d "$V" ] || python3 -m venv --system-site-packages "$V"      # keeps the template's torch/CUDA, stores everything else on /workspace
. "$V/bin/activate"
if [ ! -f "$V/.ready" ]; then
  pip install -q -r requirements.txt
  [ -d "$ACESTEP_DIR" ] || git clone -q --depth 1 https://github.com/ace-step/ACE-Step "$ACESTEP_DIR"
  [ -d "$SEEDVC_DIR" ] || git clone -q --depth 1 https://github.com/Plachtaa/seed-vc "$SEEDVC_DIR"
  [ -d "$RVC_DIR" ] || git clone -q --depth 1 https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI "$RVC_DIR"
  pip install -q -e "$ACESTEP_DIR" || true
  pip install -q -r "$SEEDVC_DIR/requirements.txt" || true
  pip install -q -r "$RVC_DIR/requirements.txt" || true
  touch "$V/.ready"
fi
exec uvicorn music_api:app --host 0.0.0.0 --port 8000
