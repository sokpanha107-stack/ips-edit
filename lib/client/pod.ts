'use client';
/** Optional RunPod *Pod* auto power: start before a job, stop when it finishes. Off by default; the Pod ID is stored only on this device. */
const K = 'ips-pod';
export type PodSettings = { podId: string; auto: boolean };
export function getPod(): PodSettings {
  try { const v = JSON.parse(window.localStorage.getItem(K) || '{}'); return { podId: String(v.podId || ''), auto: !!v.auto }; } catch { return { podId: '', auto: false }; }
}
export function setPod(p: PodSettings) { try { window.localStorage.setItem(K, JSON.stringify(p)); } catch { /* storage unavailable */ } }

export type PodStatus = { ok: boolean; error?: string; state?: string; gpu?: string | null; uptime?: number | null; cpuPct?: number | null; ramPct?: number | null; ramGb?: number | null; vramPct?: number | null; gpuPct?: number | null };
export async function podCall(action: 'status' | 'start' | 'stop', podId: string): Promise<PodStatus> {
  try {
    const r = await fetch('/api/runpod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, podId }) });
    return await r.json() as PodStatus;
  } catch { return { ok: false, error: 'Network error' }; }
}
/** Best effort and silent: a failure here must never block or fail a job. */
export async function podPowerOn() { const p = getPod(); if (p.auto && p.podId) await podCall('start', p.podId); }
export async function podPowerOff() { const p = getPod(); if (p.auto && p.podId) await podCall('stop', p.podId); }
