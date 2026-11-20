# Atom Edit · Music Engine worker (RunPod Pod, 24 GB GPU recommended: RTX 3090 / 4090 / A5000; 16 GB works because models load one at a time)
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 HF_HOME=/workspace/.cache/hf TORCH_HOME=/workspace/.cache/torch
RUN apt-get update && apt-get install -y --no-install-recommends python3.10 python3-pip git ffmpeg libsndfile1 curl nvidia-utils-535 && rm -rf /var/lib/apt/lists/* && ln -sf /usr/bin/python3.10 /usr/bin/python
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu121
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Model repos (pin the commit you tested). Each installs its own requirements; they run only inside their own pipeline step.
RUN git clone --depth 1 https://github.com/ace-step/ACE-Step /opt/ACE-Step && pip install --no-cache-dir -e /opt/ACE-Step || true
RUN git clone --depth 1 https://github.com/Plachtaa/seed-vc /opt/seed-vc && pip install --no-cache-dir -r /opt/seed-vc/requirements.txt || true
RUN git clone --depth 1 https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI /opt/rvc && pip install --no-cache-dir -r /opt/rvc/requirements.txt || true
COPY . .
ENV MUSIC_KEY="" IPS_IDLE_STOP=1
EXPOSE 8000
CMD ["uvicorn", "music_api:app", "--host", "0.0.0.0", "--port", "8000"]
