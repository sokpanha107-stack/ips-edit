'use client';
/**
 * Atom GPU Engine: ONE RunPod Omni-Worker serves Image, Music and Timeline Render.
 * The GPU key stays in the encrypted Vault; the browser only ever holds a 1-hour HMAC token minted by /api/gpu/token (memory only, never localStorage).
 */
export interface GpuConn { base: string; token: string; exp: number }
let cache: GpuConn | null = null;
let inflight: Promise<GpuConn | null> | null = null;
let timer: number | undefined;
const listeners = new Set<() => void>();
export const onGpuChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** Refreshes the token when missing or within 5 minutes of expiry. Resolves null when no Atom GPU is saved in the Vault. */
export function ensureGpu(force = false): Promise<GpuConn | null> {
  if (!force && cache && cache.exp - Date.now() / 1000 > 300) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch('/api/gpu/token', { method: 'POST', cache: 'no-store' })
    .then((r) => r.json())
    .then((d: { ok?: boolean; configured?: boolean; base?: string; token?: string; exp?: number }) => {
      cache = d.ok && d.base && d.token ? { base: d.base.replace(/\/+$/, ''), token: d.token, exp: Number(d.exp) } : null;
      listeners.forEach((f) => f()); return cache;
    })
    .catch(() => cache)
    .finally(() => { inflight = null; });
  return inflight;
}
/** Synchronous view used by the endpoint getters. */
export const gpuConn = (): GpuConn | null => (cache && cache.exp - Date.now() / 1000 > 30 ? cache : null);
export const gpuRoot = (): string => gpuConn()?.base ?? '';
export function clearGpu() { cache = null; listeners.forEach((f) => f()); }
/** Keeps the token fresh while the app is open (call once at app start). */
export function startGpuKeepalive() {
  if (timer !== undefined) return;
  void ensureGpu();
  timer = window.setInterval(() => { void ensureGpu(); }, 10 * 60_000);
}

export type EngineRoute = 'image' | 'music' | 'render';
export const PREFIX: Record<EngineRoute, string> = { image: '/image', music: '/music', render: '/render' };

/** Authenticated GET /status of the Omni-Worker (single dynamic GPU Performance Monitor). */
export interface OmniJob { kind: 'image' | 'music' | 'render' | 'voice'; id: string; status: string; done: number | null; total: number | null; percent: number | null; stage: string | null }
export interface OmniStatus {
  ok: boolean; state: 'idle' | 'image' | 'music' | 'render' | 'voice'; model: string | null; loaded?: string | null; step: number | null; total: number | null; percent: number | null; title: string | null;
  gpu: string; gpu_util: number | null; vram_total_gb: number | null; vram_used_gb: number | null; disk_total_gb: number; disk_used_gb: number; disk_free_gb?: number;
  active_tasks: number; queued?: { image: number; music: number; render: number; voice?: number }; uptime?: number;
  idle_in_sec?: number | null; auto_stop?: boolean; jobs?: OmniJob[];
}
export async function omniStatus(): Promise<OmniStatus | null> {
  const g = await ensureGpu(); if (!g) return null;
  try {
    const r = await fetch(`${g.base}/status`, { headers: { Authorization: `Bearer ${g.token}` }, cache: 'no-store', signal: AbortSignal.timeout(7000) });
    return r.ok ? await r.json() as OmniStatus : null;
  } catch { return null; }
}
