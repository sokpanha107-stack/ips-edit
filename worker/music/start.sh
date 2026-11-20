#!/usr/bin/env bash
# Atom Edit Music Engine on a RunPod Pod (24 GB GPU: RTX 3090 / 4090 / A5000). No Docker build needed.
# In the Pod terminal:   git clone https://github.com/sokpanha107-stack/ips-edit /workspace/ips-edit
#                        MUSIC_KEY=your-secret bash /workspace/ips-edit/worker/music/start.sh
# Expose HTTP port 8000. URL = https://<pod-id>-8000.proxy.runpod.net
set -e
cd "$(dirname "$0")"
M=/workspace/models; mkdir -p "$M"
export HF_HOME="${HF_HOME:-/workspace/.cache/hf}" TORCH_HOME="${TORCH_HOME:-/workspace/.cache/torch}"
export ACESTEP_DIR="$M/ACE-Step" SEEDVC_DIR="$M/seed-vc" RVC_DIR="$M/rvc"
command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg libsndfile1)
pip install -q -r requirements.txt
[ -d "$ACESTEP_DIR" ] || { git clone --depth 1 https://github.com/ace-step/ACE-Step "$ACESTEP_DIR" && pip install -q -e "$ACESTEP_DIR" || true; }
[ -d "$SEEDVC_DIR" ] || { git clone --depth 1 https://github.com/Plachtaa/seed-vc "$SEEDVC_DIR" && pip install -q -r "$SEEDVC_DIR/requirements.txt" || true; }
[ -d "$RVC_DIR" ] || { git clone --depth 1 https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI "$RVC_DIR" && pip install -q -r "$RVC_DIR/requirements.txt" || true; }
exec uvicorn music_api:app --host 0.0.0.0 --port 8000
