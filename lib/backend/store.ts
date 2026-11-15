import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';
import type { Job, Scene } from './types';

/** `null` clears an optional field. */
export type ScenePatch = { [K in 'status' | 'externalId' | 'meta' | 'outputUrl' | 'error' | 'attempts']?: Scene[K] | null };

export interface Store {
  /** false = data lives only in server memory and can vanish (dev only). */
  readonly persistent: boolean;
  createJob(job: Job): Promise<void>;
  getJob(id: string): Promise<Job | null>;
  listJobs(limit: number): Promise<Job[]>;
  setCancelled(id: string, value?: boolean): Promise<void>;
  updateOptions(id: string, options: Record<string, unknown>): Promise<void>;
  updateScene(jobId: string, idx: number, patch: ScenePatch): Promise<void>;
  /** Atomically move a scene queued -> running. Returns false if someone else got it first. */
  claimScene(jobId: string, idx: number): Promise<boolean>;
  deleteJob(id: string): Promise<void>;
}

const now = () => new Date().toISOString();

function applyPatch(scene: Scene, patch: ScenePatch) {
  const target = scene as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete target[key];
    else if (value !== undefined) target[key] = value;
  }
  scene.updatedAt = now();
}

/* ---------- memory (dev fallback) ---------- */
const g = globalThis as unknown as { __ipsJobs?: Map<string, Job> };
class MemoryStore implements Store {
  persistent = false;
  private get jobs() { return (g.__ipsJobs ??= new Map()); }
  async createJob(job: Job) { this.jobs.set(job.id, structuredClone(job)); }
  async getJob(id: string) { const j = this.jobs.get(id); return j ? structuredClone(j) : null; }
  async listJobs(limit: number) { return Array.from(this.jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((j) => structuredClone(j)); }
  async setCancelled(id: string, value = true) { const j = this.jobs.get(id); if (j) { j.cancelled = value; j.updatedAt = now(); } }
  async updateOptions(id: string, options: Record<string, unknown>) { const j = this.jobs.get(id); if (j) { j.options = options; j.updatedAt = now(); } }
  async updateScene(jobId: string, idx: number, patch: ScenePatch) { const s = this.jobs.get(jobId)?.scenes[idx]; if (s) applyPatch(s, patch); }
  async claimScene(jobId: string, idx: number) {
    const s = this.jobs.get(jobId)?.scenes[idx];
    if (!s || s.status !== 'queued') return false;
    s.status = 'running'; s.attempts += 1; s.updatedAt = now();
    return true;
  }
  async deleteJob(id: string) { this.jobs.delete(id); }
}

/* ---------- Supabase ---------- */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sceneFromRow = (r: Row): Scene => ({
  jobId: r.job_id, idx: r.idx, prompt: r.prompt, status: r.status, attempts: r.attempts, updatedAt: r.updated_at,
  externalId: r.external_id ?? undefined, meta: r.meta ?? undefined, outputUrl: r.output_url ?? undefined, error: r.error ?? undefined,
});
const jobFromRow = (r: Row, scenes: Scene[]): Job => ({
  id: r.id, engine: r.engine, folder: r.folder, masterPrompt: r.master_prompt, provider: r.provider,
  imageUrl: r.image_url ?? undefined, voiceId: r.voice_id ?? undefined, options: r.options ?? {},
  cancelled: r.cancelled, createdAt: r.created_at, updatedAt: r.updated_at,
  scenes: scenes.sort((a, b) => a.idx - b.idx),
});
const patchToRow = (p: ScenePatch): Row => {
  const map: Record<string, string> = { status: 'status', externalId: 'external_id', meta: 'meta', outputUrl: 'output_url', error: 'error', attempts: 'attempts' };
  const row: Row = { updated_at: now() };
  for (const [k, v] of Object.entries(p)) if (v !== undefined) row[map[k]] = v;
  return row;
};
const JOB_COLS = 'id,engine,folder,master_prompt,provider,voice_id,options,cancelled,created_at,updated_at';

class SupabaseStore implements Store {
  persistent = true;
  constructor(private db: SupabaseClient) {}
  private check<T>(res: { data: T; error: { message: string } | null }): T {
    if (res.error) throw new Error(`supabase: ${res.error.message}`);
    return res.data;
  }
  async createJob(job: Job) {
    this.check(await this.db.from('ips_jobs').insert({
      id: job.id, engine: job.engine, folder: job.folder, master_prompt: job.masterPrompt, provider: job.provider,
      image_url: job.imageUrl ?? null, voice_id: job.voiceId ?? null, options: job.options, cancelled: false,
      created_at: job.createdAt, updated_at: job.updatedAt,
    }));
    this.check(await this.db.from('ips_scenes').insert(job.scenes.map((s) => ({
      job_id: job.id, idx: s.idx, prompt: s.prompt, status: s.status, attempts: s.attempts, updated_at: s.updatedAt,
    }))));
  }
  async getJob(id: string) {
    const jobs = this.check(await this.db.from('ips_jobs').select('*').eq('id', id).limit(1));
    if (!jobs?.length) return null;
    const scenes = this.check(await this.db.from('ips_scenes').select('*').eq('job_id', id));
    return jobFromRow(jobs[0], (scenes ?? []).map(sceneFromRow));
  }
  async listJobs(limit: number) {
    const jobs = this.check(await this.db.from('ips_jobs').select(JOB_COLS).order('created_at', { ascending: false }).limit(limit)) ?? [];
    if (!jobs.length) return [];
    const scenes = this.check(await this.db.from('ips_scenes').select('*').in('job_id', jobs.map((j: Row) => j.id))) ?? [];
    return jobs.map((j: Row) => jobFromRow(j, scenes.filter((s: Row) => s.job_id === j.id).map(sceneFromRow)));
  }
  async setCancelled(id: string, value = true) { this.check(await this.db.from('ips_jobs').update({ cancelled: value, updated_at: now() }).eq('id', id)); }
  async updateOptions(id: string, options: Record<string, unknown>) { this.check(await this.db.from('ips_jobs').update({ options, updated_at: now() }).eq('id', id)); }
  async updateScene(jobId: string, idx: number, patch: ScenePatch) {
    this.check(await this.db.from('ips_scenes').update(patchToRow(patch)).eq('job_id', jobId).eq('idx', idx));
  }
  async claimScene(jobId: string, idx: number) {
    const cur = this.check(await this.db.from('ips_scenes').select('attempts,status').eq('job_id', jobId).eq('idx', idx).limit(1));
    if (!cur?.length || cur[0].status !== 'queued') return false;
    const res = this.check(await this.db.from('ips_scenes')
      .update({ status: 'running', attempts: cur[0].attempts + 1, updated_at: now() })
      .eq('job_id', jobId).eq('idx', idx).eq('status', 'queued').eq('attempts', cur[0].attempts).select('idx'));
    return (res?.length ?? 0) > 0;
  }
  async deleteJob(id: string) { this.check(await this.db.from('ips_jobs').delete().eq('id', id)); }
}

let cached: Store | null = null;
export function getStore(): Store {
  if (cached) return cached;
  const url = config.supabaseUrl();
  const key = config.supabaseServiceKey();
  cached = url && key
    ? new SupabaseStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }))
    : new MemoryStore();
  return cached;
}
