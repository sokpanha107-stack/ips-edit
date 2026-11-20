'use client';
/**
 * Music Engine client: local script parser + the strict 7-step pipeline orchestrator.
 * Audio never goes through Vercel: browser -> RunPod (CORS) and RunPod -> Supabase Storage (signed upload URL).
 */
import { getEngineEndpoint } from '@/lib/client/api';
import { getPod, podAcquire, podHealthBase, podRelease } from '@/lib/client/pod';
import { browserClient } from '@/lib/supabase/browser';

export const LOCK_SECONDS = 213;   // 3:33
export type Register = 'auto' | 'male' | 'female';
export type MixPreset = 'auto' | 'warm' | 'close' | 'stadium' | 'raw';

export interface ParsedSong { title: string; lyrics: string; sections: number; style: string; bpm: number | null; key: string; mix: MixPreset; pkg5: string; pkg6: string; hasLyrics: boolean; hasStyle: boolean; ok: boolean }

const SECTION = /^\s*[\[(*#_\-\s]*(intro|verse|pre[-\s]?chorus|chorus|hook|bridge|outro|drop|interlude|final chorus|refrain|instrumental)\b/i;
const PKG = /^[ \t>#*_📦🎵🎼]*package\s*(\d)\b[^\n]*$/gim;

/** Deterministic regex parse of the ChatGPT song output (Package 1 lyrics, 2 style/BPM/key, 3 mix notes, optional 5/6). Free and instant. */
export function parseSongScript(raw: string): ParsedSong {
  const text = raw.replace(/\r/g, '');
  const marks = Array.from(text.matchAll(PKG)).map((m) => ({ n: Number(m[1]), at: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const pkgs: Record<number, string> = {};
  marks.forEach((m, i) => { pkgs[m.n] = ((pkgs[m.n] ?? '') + text.slice(m.end, marks[i + 1]?.at ?? text.length)).trim(); });
  const lyrics = (marks.length ? pkgs[1] ?? '' : text).trim();
  const style = (pkgs[2] ?? '').trim();
  const sections = lyrics.split('\n').filter((l) => SECTION.test(l)).length;
  const all = `${style}\n${pkgs[3] ?? ''}\n${marks.length ? '' : text}`;
  const bpm = all.match(/(\d{2,3})\s*bpm|bpm\s*[:=\-–]?\s*(\d{2,3})/i);
  const key = all.match(/\bkey\b\s*(?:of)?\s*[:=\-–]?\s*([A-G][#b♯♭]?\s*(?:major|minor|maj|min|m)?)\b/i);
  const t = text.match(/(?:song\s*)?title\s*[:\-–]\s*["“*]*([^\n"”*]{2,80})/i);
  const mixText = `${pkgs[3] ?? ''}`.toLowerCase();
  const mix: MixPreset = /close[-\s]?mic|intimate/.test(mixText) ? 'close' : /stadium|arena|anthem/.test(mixText) ? 'stadium' : /raw|scream/.test(mixText) ? 'raw' : /warm|emotional/.test(mixText) ? 'warm' : 'auto';
  const bpmN = bpm ? Number(bpm[1] ?? bpm[2]) : null;
  const hasLyrics = sections > 0 || lyrics.length > 60;
  const hasStyle = style.length > 3 || (!marks.length && /style|genre|bpm/i.test(text));
  return { title: t?.[1].trim() ?? '', lyrics, sections, style: style || (marks.length ? '' : text.split('\n').filter((l) => /style|genre|mood|bpm|key/i.test(l)).join('\n')), bpm: bpmN && bpmN >= 40 && bpmN <= 240 ? bpmN : null, key: key?.[1].trim() ?? '', mix, pkg5: pkgs[5] ?? '', pkg6: pkgs[6] ?? '', hasLyrics, hasStyle, ok: hasLyrics && hasStyle };
}

export const cleanTitle = (s: string) => s.trim().replace(/\.mp3$/i, '').replace(/[^\p{L}\p{N}_ -]+/gu, '').replace(/\s+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Song';

export interface MusicJobInput {
  voice: File; adapter?: File | null; title: string; parsed: ParsedSong; register: Register; pitch: number; preset: MixPreset; lock: boolean; seed: number | null;
}
export interface StepState { step: number; percent: number; logs: string[]; error: string; done: boolean; path?: string; name?: string; elapsed: number }

const KH_LOG = [
  '', '● [1/7] ផ្ទៀងផ្ទាត់សំឡេង Signature និងត្រៀមទីតាំងផ្ទុកក្នុង Supabase Document...', '● [2/7] កំពុងដាស់ RunPod GPU និងបញ្ជូនទិន្នន័យទៅម៉ាស៊ីនកិន...',
  '● [3/7] ACE-Step 1.5 កំពុងតែងភ្លេង និងទំនុកច្រៀង (3:33)...', '● [4/7] Demucs កំពុងបំបែកសាច់ភ្លេងសុទ្ធ និងដកសំឡេង AI ចេញ...',
  '● [5/7] កំពុងបំពាក់សំឡេង Signature របស់អ្នក ១០០% (Seed-VC / RVC)...', '● [6/7] កំពុង Auto-Mix, ចាក់សោរ 3:33, Master (-14 LUFS) និងបង្កើតឯកសារ .MP3...',
  '● [7/7] កំពុងផ្ទុក .MP3 ចូល Supabase Document...',
];
export const stepLog = (n: number) => KH_LOG[n] ?? '';

const REC = 'ips-music-job';
export interface MusicRec { base: string; key: string; jobId: string; path: string; name: string; token: string; startedAt: number }
export const readMusicRec = (): MusicRec | null => { try { return JSON.parse(localStorage.getItem(REC) || 'null'); } catch { return null; } };
const writeRec = (r: MusicRec | null) => { try { if (r) localStorage.setItem(REC, JSON.stringify(r)); else localStorage.removeItem(REC); } catch { /* ignore */ } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function musicBase(): { base: string; key: string } {
  const ep = getEngineEndpoint('music'); const pod = getPod();
  const base = podHealthBase(ep.url, pod.podId);
  if (!ep.url && !pod.podId) throw new Error('NO_ENDPOINT');
  return { base, key: ep.key };
}
const hdr = (key: string): Record<string, string> => (key ? { Authorization: `Bearer ${key}` } : {});

interface WorkerStatus { status: string; step: number; percent: number; logs: string[]; error?: string; mp3_filename?: string; supabase_saved?: boolean }

/** Browser fallback when the GPU could not reach Supabase itself: pull the .mp3 from the worker, upload with the user's own session, register. */
async function fallbackSave(rec: MusicRec): Promise<void> {
  const r = await fetch(`${rec.base}/download/${rec.jobId}`, { headers: hdr(rec.key) });
  if (!r.ok) throw new Error(`Download from the GPU failed (${r.status})`);
  const blob = await r.blob();
  const up = await browserClient().storage.from('documents').upload(rec.path, blob, { contentType: 'audio/mpeg', upsert: true });
  if (up.error) throw new Error(up.error.message);
  const c = await fetch('/api/music/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: rec.path, name: rec.name }) });
  if (!c.ok) throw new Error((await c.json().catch(() => ({}))).error || `Register failed (${c.status})`);
}

/** Polls an already-started job to the end (also used to resume after the phone was locked). Always releases the GPU lease. */
export async function followJob(rec: MusicRec, on: (s: StepState) => void, cancelled: () => boolean): Promise<void> {
  let fails = 0;
  const upd = (p: Partial<StepState>) => on({ step: 3, percent: 15, logs: [], error: '', done: false, elapsed: Math.round((Date.now() - rec.startedAt) / 1000), ...p });
  try {
    for (;;) {
      if (cancelled()) return;
      await sleep(2000);
      try {
        const r = await fetch(`${rec.base}/status/${rec.jobId}`, { headers: hdr(rec.key), cache: 'no-store' });
        if (r.status === 404) throw new Error('The GPU forgot this job (it restarted). Start the render again.');
        const s = await r.json() as WorkerStatus; fails = 0;
        const logs = s.logs?.length ? s.logs : [stepLog(s.step)];
        if (s.status === 'FAILED') throw new Error(s.error || 'Render failed');
        if (s.status === 'DONE') {
          if (!s.supabase_saved) { upd({ step: 7, percent: 95, logs: [...logs, '● កំពុងរក្សាទុកតាម browser (fallback)...'] }); await fallbackSave(rec); }
          writeRec(null);
          upd({ step: 7, percent: 100, done: true, path: rec.path, name: rec.name, logs: [...logs, `✅ [7/7] រួចរាល់ ១០០%! ឯកសារ ${rec.name} បានផ្ទុកដេកចាំក្នុង Document (Supabase) ហើយ · RunPod GPU បានបិទស្វ័យប្រវត្តិ។`] });
          return;
        }
        upd({ step: s.step, percent: s.percent, logs });
      } catch (e) {
        if (e instanceof TypeError) { fails += 1; if (fails < 30) { upd({ logs: ['● បណ្ដាញដាច់បណ្ដោះអាសន្ន… កំពុងព្យាយាមម្តងទៀត'] }); continue; } }
        throw e;
      }
    }
  } catch (e) {
    upd({ error: e instanceof Error ? e.message : 'Failed', step: 0, percent: 0 });
    writeRec(null);
  } finally { await podRelease('music').catch(() => undefined); }
}

/** Steps 1-2: validate, get the Supabase upload slot, wake the GPU, send the job. Steps 3-7 are reported by the worker. */
export async function startSong(input: MusicJobInput, on: (s: StepState) => void, cancelled: () => boolean): Promise<void> {
  const t0 = Date.now();
  const upd = (p: Partial<StepState>) => on({ step: 1, percent: 0, logs: [], error: '', done: false, elapsed: Math.round((Date.now() - t0) / 1000), ...p });
  try {
    if (!input.voice) throw new Error('Signature Voice is required.');
    if (!input.parsed.ok) throw new Error('Lyrics or Style Prompt not detected yet.');
    const name = `${cleanTitle(input.title || input.parsed.title || 'Song')}.mp3`;
    upd({ step: 1, percent: 2, logs: [stepLog(1)] });
    const pr = await fetch('/api/music/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: name }) });
    const slot = await pr.json().catch(() => ({})) as { error?: string; name: string; path: string; uploadUrl: string; token: string };
    if (!pr.ok) throw new Error(slot.error || `prepare failed (${pr.status})`);
    upd({ step: 2, percent: 5, logs: [stepLog(2)] });
    const { base, key } = musicBase();
    await podAcquire('music', getEngineEndpoint('music').url, (m) => upd({ step: 2, percent: 10, logs: [stepLog(2), m ? `⚡ ${m}` : ''] }), cancelled);
    const p = input.parsed;
    const f = new FormData();
    f.append('signature_voice', input.voice, input.voice.name);
    if (input.adapter) f.append('rvc_index', input.adapter, input.adapter.name);
    f.append('params', JSON.stringify({ title: slot.name.replace(/\.mp3$/, ''), lyrics: p.lyrics, style_prompt: p.style, bpm: p.bpm, key: p.key, mix_preset: input.preset === 'auto' ? p.mix : input.preset,
      vocal_gender: input.register, pitch_shift: input.pitch, duration_lock: input.lock, duration_sec: LOCK_SECONDS, seed: input.seed, package5: p.pkg5, package6: p.pkg6 }));
    f.append('signed_upload_url', slot.uploadUrl);
    f.append('complete_callback_url', `${location.origin}/api/music/complete`);
    f.append('complete_token', slot.token);
    const r = await fetch(`${base}/render`, { method: 'POST', headers: hdr(key), body: f });
    const j = await r.json().catch(() => ({})) as { job_id?: string; error?: string; detail?: string };
    if (!r.ok || !j.job_id) throw new Error(j.error || j.detail || `GPU rejected the job (${r.status})`);
    const rec: MusicRec = { base, key, jobId: j.job_id, path: slot.path, name: slot.name, token: slot.token, startedAt: t0 };
    writeRec(rec);
    await followJob(rec, on, cancelled);
  } catch (e) {
    await podRelease('music').catch(() => undefined);
    const m = e instanceof Error ? e.message : 'Failed';
    upd({ error: m === 'NO_ENDPOINT' ? 'Connect the Music Engine first (Command Center → Music Engine, or save a Pod ID).' : m, step: 0 });
  }
}

export async function cancelSong(): Promise<void> {
  const r = readMusicRec(); writeRec(null);
  if (r) await fetch(`${r.base}/cancel/${r.jobId}`, { method: 'POST', headers: hdr(r.key) }).catch(() => undefined);
  await podRelease('music').catch(() => undefined);
}
