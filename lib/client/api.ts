/** Browser-side helpers that talk to the IPS backend (/api/*). */
export type SceneStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type JobStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
export interface JobView {
  id: string; engine: 'video' | 'kh' | 'en'; folder: string; status: JobStatus; createdAt: string;
  progress: { total: number; done: number; failed: number; running: number };
  scenes: { idx: number; status: SceneStatus; outputUrl?: string; error?: string }[];
}
export const isFinished = (s: JobStatus) => s === 'completed' || s === 'partial' || s === 'failed' || s === 'cancelled';

const KEY = 'ips-access-key';
export function getAccessKey() { try { return window.localStorage.getItem(KEY) ?? ''; } catch { return ''; } }
export function setAccessKey(value: string) { try { window.localStorage.setItem(KEY, value.trim()); } catch { /* storage unavailable */ } }

const VOICE_KEY = 'ips-voice-key';
const VIDEO_EP = 'ips-video-endpoint';
export function getVoiceKey() { try { return window.localStorage.getItem(VOICE_KEY) ?? ''; } catch { return ''; } }
export function setVoiceKey(value: string) { try { window.localStorage.setItem(VOICE_KEY, value.trim()); } catch { /* storage unavailable */ } }
export interface VideoEndpoint { url: string; key: string }
export function getVideoEndpoint(): VideoEndpoint {
  try { const v = JSON.parse(window.localStorage.getItem(VIDEO_EP) ?? '{}'); return { url: String(v.url ?? ''), key: String(v.key ?? '') }; } catch { return { url: '', key: '' }; }
}
export function setVideoEndpoint(ep: VideoEndpoint) { try { window.localStorage.setItem(VIDEO_EP, JSON.stringify({ url: ep.url.trim(), key: ep.key.trim() })); } catch { /* storage unavailable */ } }

const IMAGE_EP = 'ips-image-endpoint';
export type EngineKind = 'video' | 'image' | 'voice';
const EP_KEY: Record<'image' | 'voice', string> = { image: IMAGE_EP, voice: 'ips-voice-endpoint' };
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
  const key = getAccessKey();
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(key ? { 'x-ips-key': key } : {}), ...init?.headers }, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 401 ? 'Access key is missing or wrong (Settings).' : data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface PromptSummary { id: string; title: string; created_at: string; chars: number; preview: string }
export interface PromptFull { id: string; title: string; content: string; created_at: string }

export const api = {
  listPrompts: () => call<{ persistent: boolean; prompts: PromptSummary[] }>('/api/prompts'),
  getPrompt: (id: string) => call<{ prompt: PromptFull }>(`/api/prompts/${id}`),
  createPrompt: (title: string, content: string) => call<{ prompt: PromptFull }>('/api/prompts', { method: 'POST', body: JSON.stringify({ title, content }) }),
  updatePrompt: (id: string, title: string, content: string) => call<{ prompt: PromptFull }>(`/api/prompts/${id}`, { method: 'PUT', body: JSON.stringify({ title, content }) }),
  deletePrompt: (id: string) => call<{ ok: boolean }>(`/api/prompts/${id}`, { method: 'DELETE' }),
  createJob: (body: { engine: string; folder: string; masterPrompt: string; scenes: string[]; imageDataUrl?: string; voiceId?: string; options?: Record<string, unknown> }) => {
    // Every job goes to the GPU worker saved in Command Center (Colab, RunPod, ...): video -> Video Engine, kh/en -> Voice Engine.
    const ep = getEngineEndpoint(body.engine === 'video' ? 'video' : 'voice');
    const endpoint = ep?.url ? { url: ep.url, ...(ep.key ? { key: ep.key } : {}) } : undefined;
    return call<JobView>('/api/jobs', { method: 'POST', body: JSON.stringify({ ...body, ...(endpoint ? { endpoint } : {}) }) });
  },
  translate: (text: string, from: 'km' | 'en', to: 'km' | 'en') => {
    const ep = getVideoEndpoint();
    return call<{ ok: boolean; text?: string; error?: string; via?: string }>('/api/translate', { method: 'POST', body: JSON.stringify({ text, from, to, ...(ep.url ? { endpoint: { url: ep.url, ...(ep.key ? { key: ep.key } : {}) } } : {}) }) });
  },
  connect: (ep: VideoEndpoint, mode: 'connect' | 'refresh' = 'connect') =>
    call<ConnectResult>('/api/connect', { method: 'POST', body: JSON.stringify({ url: ep.url, key: ep.key || undefined, mode }) }),
  getJob: (id: string) => call<JobView>(`/api/jobs/${id}`),
  cancelJob: (id: string) => call<JobView>(`/api/jobs/${id}`, { method: 'DELETE' }),
  /** Continue a paused job from its first unfinished scene (sends the current GPU endpoint in case the Colab URL changed). */
  resumeJob: (id: string) => {
    const ep = getVideoEndpoint();
    return call<JobView>(`/api/jobs/${id}/resume`, { method: 'POST', body: JSON.stringify(ep.url ? { endpoint: { url: ep.url, ...(ep.key ? { key: ep.key } : {}) } } : {}) });
  },
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
