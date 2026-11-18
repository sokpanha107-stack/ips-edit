/** Browser-side helpers that talk to the IPS backend (/api/*). */
export type SceneStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type JobStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
export interface JobView {
  id: string; engine: 'video' | 'kh' | 'en'; folder: string; status: JobStatus; createdAt: string;
  progress: { total: number; done: number; failed: number; running: number };
  scenes: { idx: number; status: SceneStatus; outputUrl?: string; error?: string }[];
}
export const isFinished = (s: JobStatus) => s === 'completed' || s === 'partial' || s === 'failed' || s === 'cancelled';

const VIDEO_EP = 'ips-video-endpoint';
export interface VideoEndpoint { url: string; key: string }
export function getVideoEndpoint(): VideoEndpoint {
  try { const v = JSON.parse(window.localStorage.getItem(VIDEO_EP) ?? '{}'); return { url: String(v.url ?? ''), key: String(v.key ?? '') }; } catch { return { url: '', key: '' }; }
}
export function setVideoEndpoint(ep: VideoEndpoint) { try { window.localStorage.setItem(VIDEO_EP, JSON.stringify({ url: ep.url.trim(), key: ep.key.trim() })); } catch { /* storage unavailable */ } }

const IMAGE_EP = 'ips-image-endpoint';
export type EngineKind = 'video' | 'image';
const EP_KEY: Record<'image', string> = { image: IMAGE_EP };
export const getEngineEndpoint = (k: EngineKind): VideoEndpoint => {
  if (k === 'video') return getVideoEndpoint();
  try { const v = JSON.parse(window.localStorage.getItem(EP_KEY[k]) ?? '{}'); return { url: String(v.url ?? ''), key: String(v.key ?? '') }; } catch { return { url: '', key: '' }; }
};
export const setEngineEndpoint = (k: EngineKind, ep: VideoEndpoint) => {
  if (k === 'video') return setVideoEndpoint(ep);
  try { window.localStorage.setItem(EP_KEY[k], JSON.stringify({ url: ep.url.trim(), key: ep.key.trim() })); } catch { /* storage unavailable */ }
};
export const getImageEndpoint = () => getEngineEndpoint('image');

export interface HardwareInfo { gpu: string; vramTotalGb?: number; vramUsedGb?: number; diskTotalGb?: number; diskUsedGb?: number; model?: string; activeTasks?: number }
export interface ConnectResult {
  ok: boolean; error?: string; note?: string; kind?: 'runpod' | 'http';
  hardware?: HardwareInfo | null; workers?: { idle: number; running: number; ready: number }; activeTasks?: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers }, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== 'undefined') { window.location.assign('/login'); throw new Error('Session expired. Signing in again…'); }
  if (!res.ok) throw new Error(data.error ?? data.message ?? `Request failed (${res.status})`);
  return data as T;
}

export interface VaultService { service: 'runpod' | 'voice_api' | 'gemini' | 'video'; hasKey: boolean; hint: string; endpoint: string | null; status: 'connected' | 'failed' | null; checkedAt: string | null }

export interface PromptSummary { id: string; title: string; created_at: string; chars: number; preview: string }
export interface PromptFull { id: string; title: string; content: string; created_at: string }

export const api = {
  listPrompts: () => call<{ persistent: boolean; prompts: PromptSummary[] }>('/api/prompts'),
  getPrompt: (id: string) => call<{ prompt: PromptFull }>(`/api/prompts/${id}`),
  createPrompt: (title: string, content: string) => call<{ prompt: PromptFull }>('/api/prompts', { method: 'POST', body: JSON.stringify({ title, content }) }),
  updatePrompt: (id: string, title: string, content: string) => call<{ prompt: PromptFull }>(`/api/prompts/${id}`, { method: 'PUT', body: JSON.stringify({ title, content }) }),
  deletePrompt: (id: string) => call<{ ok: boolean }>(`/api/prompts/${id}`, { method: 'DELETE' }),
  createJob: (body: { engine: string; folder: string; masterPrompt: string; scenes: string[]; imageDataUrl?: string; voiceId?: string; options?: Record<string, unknown> }) =>
    call<JobView>('/api/jobs', { method: 'POST', body: JSON.stringify(body) }),   // the server uses the keys in your API Key Vault
  translate: (text: string, from: 'km' | 'en', to: 'km' | 'en') =>
    call<{ ok: boolean; text?: string; error?: string; via?: string }>('/api/translate', { method: 'POST', body: JSON.stringify({ text, from, to }) }),
  vault: () => call<{ services: VaultService[] }>('/api/vault'),
  saveVault: (service: VaultService['service'], key: string, endpoint: string) =>
    call<{ ok: boolean; message: string; services: VaultService[] }>('/api/vault', { method: 'PUT', body: JSON.stringify({ service, ...(key ? { key } : {}), endpoint }) }),
  deleteVault: (service: VaultService['service']) => call<{ services: VaultService[] }>(`/api/vault?service=${service}`, { method: 'DELETE' }),
  /** Files finished outputs into a new Document folder and sends the push notification. */
  fileOutputs: (kind: 'image' | 'voice' | 'video', title: string, items: { name: string; url: string }[]) =>
    call<{ ok: boolean; folderId: string; saved: number; failed: number }>('/api/outputs', { method: 'POST', body: JSON.stringify({ kind, title, items }) }),
  connect: (ep: VideoEndpoint, mode: 'connect' | 'refresh' = 'connect') =>
    call<ConnectResult>('/api/connect', { method: 'POST', body: JSON.stringify({ url: ep.url, key: ep.key || undefined, mode }) }),
  getJob: (id: string) => call<JobView>(`/api/jobs/${id}`),
  cancelJob: (id: string) => call<JobView>(`/api/jobs/${id}`, { method: 'DELETE' }),
  resumeJob: (id: string) => call<JobView>(`/api/jobs/${id}/resume`, { method: 'POST', body: '{}' }),
  retryJob: (id: string) => call<JobView>(`/api/jobs/${id}/retry`, { method: 'POST' }),
  listJobs: () => call<{ jobs: JobView[] }>('/api/jobs'),
};

/** One entry per scene. Same rules as the scene counter in the UI. */
export function splitScenes(script: string): string[] {
  const lines = script.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const marker = /^(scene|ឈុត|ឆាក)\s*\d+\s*[.):-]?\s*|^\d+\s*[.):-]\s*/i;
  const isMarked = (l: string) => /^(scene|ឈុត|ឆាក)\s*\d+|^\d+\s*[.):-]/i.test(l);
  if (!lines.some(isMarked)) return lines;
  const out: string[] = [];
  for (const l of lines) {
    if (isMarked(l)) out.push(l.replace(marker, '').trim());
    else if (out.length) out[out.length - 1] += ` ${l}`;
  }
  return out;
}

/** Shrink the base image so the upload stays small (720p output does not need more). */
export async function imageToDataUrl(url: string, maxSide = 1280): Promise<string> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot process image');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}
