# Atom Edit - RunPod Serverless worker for Wan2.2 TI2V-5B (image -> video).
# Weights (~34 GB) are NOT baked in: they live on a Network Volume mounted at /runpod-volume.
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-devel

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone --depth 1 https://github.com/Wan-Video/Wan2.2.git /app/Wan2.2
# flash_attn is skipped (slow to build); Wan falls back to PyTorch attention.
RUN grep -vi flash_attn /app/Wan2.2/requirements.txt > /tmp/req.txt && pip install -r /tmp/req.txt

COPY worker/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt
COPY worker/handler.py /app/handler.py

ENV HF_HOME=/runpod-volume/hf WAN_DIR=/app/Wan2.2 MODEL_DIR=/runpod-volume/models/Wan2.2-TI2V-5B
CMD ["python", "-u", "/app/handler.py"]
