'use client';
import { ensureGpu, gpuConn } from './gpu';

/** Voice Engine on the Atom GPU: Khmer / English speech in the user's Signature Voice (TTS -> Seed-VC), saved as 01.mp3, 02.mp3… in Document by the GPU itself. */
export interface CloneStatus { status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'; stage: string; progress: number; done: number; total: number; saved: number; durations: number[]; tts?: string | null; error?: string | null }
export const cloneReady = () => !!gpuConn();

export async function startVoiceClone(o: { lang: 'kh' | 'en'; scenes: string[]; folder: string; sample: Blob; brand?: string; gender?: 'female' | 'male' }): Promise<{ id: string; total: number }> {
  const g = await ensureGpu(); if (!g) throw new Error('NO_ENDPOINT');
  const pad = o.scenes.length > 99 ? 3 : 2;
  const pr = await fetch('/api/voice/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: o.folder, scenes: o.scenes.length, pad }) });
  const pd = await pr.json().catch(() => ({}));
  if (!pr.ok || !pd.ok) throw new Error(pd.error || `prepare failed (${pr.status})`);
  const payload = { lang: o.lang, scenes: o.scenes, gender: o.gender ?? 'female', pad, brand: o.brand ?? '',
    finalize: { callback: `${location.origin}/api/voice/complete`, token: pd.token, slots: pd.slots, offset: 0, jobId: pd.jobId } };
  const fd = new FormData(); fd.append('voice', o.sample, 'signature.wav'); fd.append('payload', JSON.stringify(payload));
  const r = await fetch(`${g.base}/voice/api/clone`, { method: 'POST', headers: { Authorization: `Bearer ${g.token}` }, body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || d.error || `GPU refused the job (${r.status})`);
  return { id: d.id, total: d.total };
}
export async function voiceCloneStatus(id: string): Promise<CloneStatus> {
  const g = await ensureGpu(); if (!g) throw new Error('NO_ENDPOINT');
  const r = await fetch(`${g.base}/voice/api/clone/status/${id}`, { headers: { Authorization: `Bearer ${g.token}` }, cache: 'no-store' });
  if (r.status === 404) throw Object.assign(new Error('unknown job'), { lost: true });
  if (!r.ok) throw new Error(`status ${r.status}`);
  return r.json();
}
export async function cancelVoiceClone(id: string) {
  const g = gpuConn(); if (!g) return;
  await fetch(`${g.base}/voice/api/clone/cancel/${id}`, { method: 'POST', headers: { Authorization: `Bearer ${g.token}` } }).catch(() => undefined);
}
