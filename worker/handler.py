"""RunPod Serverless handler: image + prompt -> 720p video (Wan2.2 TI2V-5B), uploaded to Supabase Storage.

input : { engine:'video', prompt, image:<data URL or https URL>, job_id, scene, options:{frame_num?, steps?, seed?} }
         or { engine:'warmup' }  -> only downloads the model weights to the network volume
output: { url }  (public Supabase Storage URL)

Env (set on the RunPod endpoint): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET (default ips-videos)
"""
import base64, os, struct, subprocess, tempfile, uuid
import requests
import runpod

WAN_DIR = os.environ.get("WAN_DIR", "/app/Wan2.2")
MODEL_DIR = os.environ.get("MODEL_DIR", "/runpod-volume/models/Wan2.2-TI2V-5B")
BUCKET = os.environ.get("SUPABASE_BUCKET", "ips-videos")


def ensure_model():
    if os.path.exists(os.path.join(MODEL_DIR, "config.json")):
        return
    from huggingface_hub import snapshot_download
    os.makedirs(MODEL_DIR, exist_ok=True)
    snapshot_download("Wan-AI/Wan2.2-TI2V-5B", local_dir=MODEL_DIR)


def load_image(src: str, dest: str):
    if src.startswith("data:"):
        data = base64.b64decode(src.split(",", 1)[1])
    else:
        r = requests.get(src, timeout=60); r.raise_for_status(); data = r.content
    with open(dest, "wb") as f:
        f.write(data)


def pick_size(path: str) -> str:
    from PIL import Image
    w, h = Image.open(path).size
    return "704*1280" if h > w else "1280*704"


def upload(path: str, key: str) -> str:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    token = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    with open(path, "rb") as f:
        r = requests.post(
            f"{base}/storage/v1/object/{BUCKET}/{key}",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "video/mp4", "x-upsert": "true"},
            data=f, timeout=600,
        )
    if not r.ok:
        raise RuntimeError(f"upload failed {r.status_code}: {r.text[:200]}")
    return f"{base}/storage/v1/object/public/{BUCKET}/{key}"


def handler(event):
    inp = event.get("input", {})
    ensure_model()
    if inp.get("engine") == "warmup":
        return {"ok": True}

    opts = inp.get("options") or {}
    work = tempfile.mkdtemp()
    img, out = os.path.join(work, "in.png"), os.path.join(work, "out.mp4")
    load_image(inp["image"], img)

    cmd = [
        "python", "generate.py", "--task", "ti2v-5B", "--size", pick_size(img),
        "--ckpt_dir", MODEL_DIR, "--offload_model", "True", "--convert_model_dtype", "--t5_cpu",
        "--image", img, "--prompt", inp.get("prompt") or "gentle natural motion", "--save_file", out,
        "--frame_num", str(int(opts.get("frame_num", 121))),
    ]
    if opts.get("steps"):
        cmd += ["--sample_steps", str(int(opts["steps"]))]
    if opts.get("seed") is not None:
        cmd += ["--base_seed", str(int(opts["seed"]))]

    p = subprocess.run(cmd, cwd=WAN_DIR, capture_output=True, text=True)
    if p.returncode != 0 or not os.path.exists(out):
        raise RuntimeError("generation failed: " + (p.stderr or p.stdout)[-600:])

    key = f"{inp.get('job_id', 'job')}/{inp.get('scene', 0)}-{uuid.uuid4().hex[:6]}.mp4"
    return {"url": upload(out, key)}


runpod.serverless.start({"handler": handler})
