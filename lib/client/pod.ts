'use client';
/**
 * Zero-touch RunPod Pod lifecycle. With "Auto-Start & Auto-Stop GPU" on (the default) and a Pod ID saved:
 *   podAcquire(job)  wakes a stopped Pod, then waits until its worker answers /health
 *   podRelease(job)  stops the Pod once NO job on this device still needs it
 * The Pod ID is stored only on this device; the RunPod API key stays in the encrypted Vault (the server route does the calls).
 * A watchdog inside the Pod (worker/render/render_api.py) is the safety net if this device goes offline mid-job.
 */
const K = 'ips-pod';
export type PodSettings = { podId: string; auto: boolean };
/** Auto is ON unless the user switched it off after this version (older saves without `v` get the new default). */
export function getPod(): PodSettings {
  try {
    const v = JSON.parse(window.localStorage.getItem(K) || '{}');
    return { podId: String(v.podId || ''), auto: v.v === 2 ? !!v.auto : true };
  } catch { return { podId: '', auto: true }; }
}
export function setPod(p: PodSettings) { try { window.localStorage.setItem(K, JSON.stringify({ ...p, v: 2 })); } catch { /* storage unavailable */ } }

export type PodStatus = { ok: boolean; error?: string; state?: string; gpu?: string | null; uptime?: number | null; cpuPct?: number | null; ramPct?: number | null; ramGb?: number | null; vramPct?: number | null; gpuPct?: number | null };
export async function podCall(action: 'status' | 'start' | 'stop', podId: string): Promise<PodStatus> {
  try {
    const r = await fetch('/api/runpod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, podId }) });
    return await r.json() as PodStatus;
  } catch { return { ok: false, error: 'Network error' }; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Where the worker answers /health: the saved endpoint when it is a direct URL, otherwise the Pod's RunPod proxy address (port 8000). */
export function podHealthBase(endpointUrl: string, podId: string): string {
  const u = (endpointUrl || '').trim().replace(/\/+$/, '').replace(/\/(run|runsync)$/, '');
  return u && !/api\.runpod\.ai\/v2/i.test(u) ? u : `https://${podId}-8000.proxy.runpod.net`;
}
async function healthOk(base: string): Promise<boolean> {
  try { return (await fetch(`${base}/health`, { cache: 'no-store', signal: AbortSignal.timeout(6000) })).ok; } catch { return false; }
}

const leases = new Set<string>();
export const podLeases = () => leases.size;

/**
 * Registers `job` as needing the GPU and makes sure the worker is up. Throws a readable error if it cannot be woken
 * (the caller then calls podRelease). No-op when auto power is off or no Pod ID is saved.
 */
export async function podAcquire(job: string, endpointUrl: string, onStage?: (msg: string) => void, cancelled?: () => boolean): Promise<void> {
  leases.add(job);
  const p = getPod();
  if (!p.auto || !p.podId) return;
  const base = podHealthBase(endpointUrl, p.podId);
  if (await healthOk(base)) return;                                   // already awake
  const st = await podCall('status', p.podId);
  if (!st.ok) throw new Error(st.error || 'Could not read the RunPod Pod status.');
  if (st.state !== 'RUNNING') {
    onStage?.('Starting RunPod GPU...');
    const r = await podCall('start', p.podId);
    if (!r.ok) throw new Error(r.error || 'RunPod could not start the Pod (no GPU free on that machine?).');
  }
  onStage?.('Waiting for GPU worker...');
  const t0 = Date.now();
  while (Date.now() - t0 < 8 * 60_000) {
    if (cancelled?.()) throw new Error('cancelled');
    if (await healthOk(base)) { onStage?.(''); return; }
    await sleep(4000);
  }
  throw new Error('The GPU worker did not answer within 8 minutes. Check that the Pod runs worker/render/start.sh on port 8000.');
}

/** Job finished, failed or was cancelled. The Pod stops only when no other job on this device still holds it. Silent: never blocks the UI. */
export async function podRelease(job: string): Promise<void> {
  leases.delete(job);
  const p = getPod();
  if (leases.size === 0 && p.auto && p.podId) await podCall('stop', p.podId);
}
