/** Helpers for user-supplied GPU worker endpoints (Google Colab, RunPod, or any server that follows the contract). */

export interface Endpoint { url: string; key?: string }

export interface Hardware {
  gpu: string;
  vramTotalGb?: number;
  vramUsedGb?: number;
  diskTotalGb?: number;
  diskUsedGb?: number;
  model?: string;
  activeTasks?: number;
}

/** https only, and never an internal address (blocks SSRF to localhost / private networks / cloud metadata). */
export function publicHttpsUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error('URL is not valid'); }
  if (u.protocol !== 'https:') throw new Error('URL must start with https://');
  const host = u.hostname.toLowerCase();
  const privateV4 = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host);
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || privateV4 || host.includes(':')) throw new Error('URL must be a public address');
  return u;
}

/** Trim, force https, drop trailing slash and any /run or /runsync suffix. Throws on unsafe input. */
export function normalizeBase(raw: string): string {
  const u = publicHttpsUrl(raw);
  const path = u.pathname.replace(/\/(run|runsync|health|status\/[^/]+)\/?$/, '').replace(/\/+$/, '');
  return `${u.origin}${path}`;
}

export const isRunpod = (base: string) => new URL(base).hostname === 'api.runpod.ai';

export function authHeaders(ep: Endpoint): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(ep.key ? { Authorization: `Bearer ${ep.key}` } : {}) };
}

export async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 15000, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: ctrl.signal, cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally { clearTimeout(timer); }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const pick = (o: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
const gb = (o: Record<string, unknown>, gbKeys: string[], mbKeys: string[]) => {
  const g = num(pick(o, gbKeys)); if (g !== undefined) return Math.round(g * 10) / 10;
  const m = num(pick(o, mbKeys)); return m !== undefined ? Math.round((m / 1024) * 10) / 10 : undefined;
};

/** Accept the common shapes workers return and map them to one format. Returns null if there is no GPU name. */
export function normalizeHardware(raw: unknown): Hardware | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const o = (r.output && typeof r.output === 'object' ? r.output : r.hardware && typeof r.hardware === 'object' ? r.hardware : r) as Record<string, unknown>;
  const gpuName = pick(o, ['gpu', 'gpu_name', 'gpuName', 'name']);
  if (typeof gpuName !== 'string' || !gpuName) return null;
  const model = pick(o, ['model', 'model_loaded', 'modelLoaded', 'model_name']);
  return {
    gpu: gpuName,
    vramTotalGb: gb(o, ['vram_total_gb', 'vramTotalGb'], ['vram_total_mb', 'memory_total_mb', 'vram_total']),
    vramUsedGb: gb(o, ['vram_used_gb', 'vramUsedGb'], ['vram_used_mb', 'memory_used_mb', 'vram_used']),
    diskTotalGb: gb(o, ['disk_total_gb', 'diskTotalGb'], []),
    diskUsedGb: gb(o, ['disk_used_gb', 'diskUsedGb'], []),
    model: typeof model === 'string' ? model : undefined,
    activeTasks: num(pick(o, ['active_tasks', 'activeTasks', 'tasks'])),
  };
}
