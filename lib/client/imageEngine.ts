import { getEngineEndpoint } from './api';

export interface ImageJob { id: string; base: string; key: string }
export interface ImageStatus { status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'; progress: number; stage: string; done: number; total: number; error?: string | null; images: { index: number; name: string; url: string }[] }
export interface ImageOptions { width: number; height: number; scale: number; steps: number; seed: string; negative: string }

const hdr = (key: string): Record<string, string> => (key ? { Authorization: `Bearer ${key}` } : {});

/** "Scene 3: a girl by the sea" -> "a girl by the sea". Blank lines are dropped. */
export function parsePrompts(raw: string, suffix = ''): string[] {
  return raw.split(/\r?\n/).map((l) => l.replace(/^\s*(scene\s*\d+|\d+)\s*[.):\-–]\s*/i, '').trim()).filter(Boolean).map((l) => (suffix.trim() ? `${l}, ${suffix.trim()}` : l));
}

/** POST /api/generate-image on the Image Engine: the Signature Image + an array of scene prompts (max 100). Goes straight from the browser to your GPU server. */
export function startImageJob(signature: File, prompts: string[], opt: ImageOptions): Promise<ImageJob> {
  const ep = getEngineEndpoint('image');
  return new Promise((resolve, reject) => {
    if (!ep.url) return reject(new Error('NO_ENDPOINT'));
    if (/runpod\.ai/i.test(ep.url)) return reject(new Error('RUNPOD'));
    const base = ep.url.trim().replace(/\/+$/, '');
    const form = new FormData();
    form.append('signature', signature, signature.name);
    form.append('payload', JSON.stringify({ prompts, width: opt.width, height: opt.height, scale: opt.scale, steps: opt.steps, seed: opt.seed.trim() ? Number(opt.seed) : null, negative: opt.negative.trim() || undefined }));
    fetch(`${base}/api/generate-image`, { method: 'POST', headers: hdr(ep.key), body: form })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (res.status === 401) throw new Error('Wrong API key for the Image Engine.');
        if (!res.ok || !d.id) throw new Error(d.error || `Image Engine answered ${res.status}`);
        resolve({ id: d.id, base, key: ep.key });
      })
      .catch((e) => reject(e instanceof TypeError ? new Error('Cannot reach the Image Engine. Is the Colab cell still running and the URL current?') : e));
  });
}

export async function imageStatus(job: ImageJob): Promise<ImageStatus> {
  const res = await fetch(`${job.base}/api/generate-image/status/${job.id}`, { headers: hdr(job.key), cache: 'no-store' });
  const d = await res.json();
  if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`);
  return { ...d, images: (d.images ?? []).map((i: { index: number; name: string; url: string }) => ({ ...i, url: /^https?:/.test(i.url) ? i.url : `${job.base}${i.url}` })) };
}

export async function cancelImageJob(job: ImageJob) {
  try { await fetch(`${job.base}/api/generate-image/cancel/${job.id}`, { method: 'POST', headers: hdr(job.key) }); } catch { /* best effort */ }
}

export async function fetchImageFile(url: string, name: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${name}`);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}
