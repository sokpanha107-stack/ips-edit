# Atom Edit · Timeline render server for RunPod Pods (build from the repo root:  docker build -f worker/render/Dockerfile -t atom-render .)
# Or skip Docker: start any "RunPod PyTorch" Pod, open its terminal and run  bash worker/render/start.sh
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1 \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,video \
    HF_HOME=/workspace/.cache/hf TORCH_HOME=/workspace/.cache/torch IPS_CACHE_DIR=/workspace/.cache
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fontconfig libgl1 libglib2.0-0 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker/render/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt
COPY worker/render/main.py worker/render/render_api.py worker/render/motion_fx.py /app/
EXPOSE 8000
# RENDER_KEY (set in the Pod's environment variables) protects the API; the app sends it from Command Center -> Video Engine.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
