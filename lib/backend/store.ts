import type { SupabaseClient } from '@supabase/supabase-js';
import type { Job, Scene } from './types';

/** `null` clears an optional field. */
export type ScenePatch = { [K in 'status' | 'externalId' | 'meta' | 'outputUrl' | 'error' | 'attempts']?: Scene[K] | null };

export interface Store {
  createJob(job: Job): Promise<void>;
  getJob(id: string): Promise<Job | null>;
  listJobs(limit: number): Promise<Job[]>;
  setCancelled(id: string, value?: boolean): Promise<void>;
  updateOptions(id: string, options: Record<string, unknown>): Promise<void>;
  updateScene(jobId: string, idx: number, patch: ScenePatch): Promise<void>;
  /** Atomically move a scene queued -> running. Returns false if someone else got it first. */
  claimScene(jobId: string, idx: number): Promise<boolean>;
  deleteJob(id: string): Promise<void>;
  /** First caller wins: marks the finished job as archived so outputs are filed (and the push sent) exactly once. */
  claimArchive(job: Job): Promise<boolean>;
}

const now = () => new Date().toISOString();

/* ---------- Supabase ---------- */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sceneFromRow = (r: Row): Scene => ({
  jobId: r.job_id, idx: r.idx, prompt: r.prompt, status: r.status, attempts: r.attempts, updatedAt: r.updated_at,
  externalId: r.external_id ?? undefined, meta: r.meta ?? undefined, outputUrl: r.output_url ?? undefined, error: r.error ?? undefined,
});
const jobFromRow = (r: Row, scenes: Scene[]): Job => ({
  id: r.id, userId: r.user_id ?? undefined, engine: r.engine, folder: r.folder, masterPrompt: r.master_prompt, provider: r.provider,
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
const JOB_COLS = 'id,user_id,engine,folder,master_prompt,provider,voice_id,options,cancelled,created_at,updated_at';

class SupabaseStore implements Store {
  /** `userId` is also written on every row; RLS (user client) or the explicit filter (admin client) keeps users apart. */
  constructor(private db: SupabaseClient, private userId?: string) {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private own<T>(q: T): T { return this.userId ? (q as any).eq('user_id', this.userId) : q; }
  private check<T>(res: { data: T; error: { message: string } | null }): T {
    if (res.error) throw new Error(`supabase: ${res.error.message}`);
    return res.data;
  }
  async createJob(job: Job) {
    this.check(await this.db.from('ips_jobs').insert({
      id: job.id, user_id: this.userId ?? job.userId, engine: job.engine, folder: job.folder, master_prompt: job.masterPrompt, provider: job.provider,
      image_url: job.imageUrl ?? null, voice_id: job.voiceId ?? null, options: job.options, cancelled: false,
      created_at: job.createdAt, updated_at: job.updatedAt,
    }));
    this.check(await this.db.from('ips_scenes').insert(job.scenes.map((s) => ({
      job_id: job.id, user_id: this.userId ?? job.userId, idx: s.idx, prompt: s.prompt, status: s.status, attempts: s.attempts, updated_at: s.updatedAt,
    }))));
  }
  async getJob(id: string) {
    const jobs = this.check(await this.own(this.db.from('ips_jobs').select('*').eq('id', id)).limit(1));
    if (!jobs?.length) return null;
    const scenes = this.check(await this.db.from('ips_scenes').select('*').eq('job_id', id));
    return jobFromRow(jobs[0], (scenes ?? []).map(sceneFromRow));
  }
  async listJobs(limit: number) {
    const jobs = this.check(await this.own(this.db.from('ips_jobs').select(JOB_COLS)).order('created_at', { ascending: false }).limit(limit)) ?? [];
    if (!jobs.length) return [];
    const scenes = this.check(await this.db.from('ips_scenes').select('*').in('job_id', jobs.map((j: Row) => j.id))) ?? [];
    return jobs.map((j: Row) => jobFromRow(j, scenes.filter((s: Row) => s.job_id === j.id).map(sceneFromRow)));
  }
  async setCancelled(id: string, value = true) { this.check(await this.own(this.db.from('ips_jobs').update({ cancelled: value, updated_at: now() }).eq('id', id))); }
  async updateOptions(id: string, options: Record<string, unknown>) { this.check(await this.own(this.db.from('ips_jobs').update({ options, updated_at: now() }).eq('id', id))); }
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
  async claimArchive(job: Job) {
    const res = this.check(await this.own(this.db.from('ips_jobs').update({ options: { ...job.options, _archived: true }, updated_at: now() }).eq('id', job.id)).is('options->>_archived', null).select('id'));
    return (res?.length ?? 0) > 0;
  }
  async deleteJob(id: string) { this.check(await this.own(this.db.from('ips_jobs').delete().eq('id', id))); }
}

/** A store bound to one user's Supabase client (RLS applies). Pass the admin client + no userId only for provider webhooks. */
export function getStore(db: SupabaseClient, userId?: string): Store { return new SupabaseStore(db, userId); }
