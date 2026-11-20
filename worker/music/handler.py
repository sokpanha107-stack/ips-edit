"""RunPod Serverless wrapper around the SAME pipeline as music_api.py (no Pod, no polling).
input: { voice_b64, voice_name, index_b64?, params:{...}, signed_upload_url, complete_callback_url, complete_token }  ->  { ok, mp3_filename, duration_sec, supabase_saved }"""
import base64, tempfile
from pathlib import Path
import runpod
import pipeline


def handler(event):
    i = event.get('input') or {}
    if not i.get('voice_b64'): return {'error': 'signature_voice is required'}
    p = dict(i.get('params') or {}); p['title'] = ''.join(c for c in str(p.get('title') or 'Song') if c.isalnum() or c in '_-') or 'Song'
    d = Path(tempfile.mkdtemp(prefix='job_'))
    voice = d / (Path(i.get('voice_name') or 'voice.wav').name); voice.write_bytes(base64.b64decode(i['voice_b64']))
    index = None
    if i.get('index_b64'): index = d / 'model.index'; index.write_bytes(base64.b64decode(i['index_b64']))
    out = d / f"{p['title']}.mp3"
    dur = pipeline.render(p, voice, index, out, lambda s, pct, log: runpod.serverless.progress_update(event, f'[{s}/7] {pct}% {log}'))
    saved = bool(i.get('signed_upload_url') and pipeline.upload(i['signed_upload_url'], out, i.get('complete_callback_url', ''), i.get('complete_token', '')))
    return {'ok': True, 'mp3_filename': out.name, 'duration_sec': dur, 'supabase_saved': saved}


if __name__ == '__main__':
    runpod.serverless.start({'handler': handler})
