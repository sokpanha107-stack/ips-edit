"""Atom Edit · Music Engine idle watchdog: no API request AND no running job for 3 minutes => stop this RunPod Pod. Inside the Omni-Worker (ATOM_EMBEDDED=1) the Omni watchdog does this instead."""
import os, subprocess, threading, time, urllib.request
from pathlib import Path

IDLE_TIMEOUT_SECONDS = 180
ACTIVITY_FILE = Path(os.environ.get('IPS_ACTIVITY_FILE', '/tmp/ips_last_activity'))   # shared with the render server on the same Pod
_STARTED = time.time()
INFLIGHT = {'n': 0}


def touch():
    try: ACTIVITY_FILE.touch()
    except OSError: pass


IDLE_ON = os.environ.get('ATOM_IDLE_STOP', os.environ.get('IPS_IDLE_STOP', '1')) != '0'   # ATOM_IDLE_STOP, with the old IPS_IDLE_STOP as fallback
EMBEDDED = os.environ.get('ATOM_EMBEDDED') == '1'


def _stop_pod() -> bool:
    pod = os.environ.get('RUNPOD_POD_ID', '')
    key = os.environ.get('IPS_RUNPOD_API_KEY') or os.environ.get('RUNPOD_API_KEY', '')
    try:
        req = urllib.request.Request(f'https://rest.runpod.io/v1/pods/{pod}/stop', method='POST', headers={'Authorization': f'Bearer {key}'})
        with urllib.request.urlopen(req, timeout=20) as r:
            if 200 <= r.status < 300: return True
    except Exception as e:  # noqa: BLE001
        print('[watchdog] REST stop failed:', str(e)[:160])
    try: return subprocess.run(['runpodctl', 'stop', 'pod', pod], capture_output=True, timeout=30).returncode == 0
    except Exception: return False  # noqa: BLE001


def _loop():
    while True:
        time.sleep(10)
        try: last = max(_STARTED, ACTIVITY_FILE.stat().st_mtime)
        except OSError: last = _STARTED
        if INFLIGHT['n'] > 0 or time.time() - last < IDLE_TIMEOUT_SECONDS: continue
        if _stop_pod(): return
        time.sleep(60)


def stop_after(seconds: int):
    """Job finished and saved: stop the Pod after a short grace period (lets the app read the final status) unless a new job started."""
    def _go():
        time.sleep(seconds)
        if INFLIGHT['n'] == 0 and os.environ.get('RUNPOD_POD_ID') and IDLE_ON and not EMBEDDED: _stop_pod()
    threading.Thread(target=_go, daemon=True).start()


def start(app):
    """Adds the activity middleware and the timer thread. No-op outside a RunPod Pod (or with ATOM_IDLE_STOP=0)."""
    @app.middleware('http')
    async def activity(request, call_next):
        counts = request.method != 'OPTIONS' and request.url.path not in ('/health', '/ping')
        if counts: touch(); INFLIGHT['n'] += 1
        try: return await call_next(request)
        finally:
            if counts: INFLIGHT['n'] -= 1; touch()
    touch()
    if os.environ.get('RUNPOD_POD_ID') and IDLE_ON and not EMBEDDED:
        threading.Thread(target=_loop, daemon=True).start()
