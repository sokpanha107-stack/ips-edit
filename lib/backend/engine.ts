import { randomUUID } from 'crypto';
import { config } from './config';
import { archiveFinished } from './outputs';
import { getProvider } from './providers';
import { ProviderConfigError } from './providers/types';
import type { Ctx } from './session';
import { getStore } from './store';
import { endpointBase, resolveCredential } from './vault';
import type { Job, Scene } from './types';
import type { SceneResult } from './providers/types';

export const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MS = 120_000;

export interface NewJob {
  engine: Job['engine'];
  folder: string;
  masterPrompt: string;
  scenes: string[];
  imageDataUrl?: string;
  voiceId?: string;
  options?: Record<string, unknown>;
}

export async function createJob(ctx: Ctx, input: NewJob): Promise<Job> {
  if (input.scenes.length > config.maxScenes()) throw new Error(`Too many scenes (max ${config.maxScenes()})`);
  // Which worker? Video always needs the user's RunPod key. Voice uses their Premium Voice key if saved, otherwise the free gTTS tool.
  const cred = await resolveCredential(ctx.db, ctx.userId, input.engine);
  if (input.engine === 'video' && !cred?.endpoint) throw new ProviderConfigError('Add your RunPod key and Endpoint ID in Settings → API Key Vault first.');
  const provider = input.engine !== 'video' && !cred?.endpoint ? 'gtts' : 'http';
  getProvider(provider);
  const ts = new Date().toISOString();
  const job: Job = {
    id: randomUUID(), userId: ctx.userId, engine: input.engine, folder: input.folder, masterPrompt: input.masterPrompt, provider,
    imageUrl: input.imageDataUrl, voiceId: input.voiceId, options: { ...(input.options ?? {}) }, cancelled: false,
    createdAt: ts, updatedAt: ts,
    scenes: input.scenes.map((prompt, idx): Scene => ({ jobId: '', idx, prompt, status: 'queued', attempts: 0, updatedAt: ts })),
  };
  job.scenes.forEach((s) => { s.jobId = job.id; });
  await getStore(ctx.db, ctx.userId).createJob(job);
  return job;
}

/** The provider sees the user's decrypted endpoint only in memory for this call; it is never written to the database. */
async function withEndpoint(ctx: Ctx, job: Job): Promise<Job> {
  if (job.provider !== 'http') return job;
  const cred = await resolveCredential(ctx.db, job.userId ?? ctx.userId, job.engine);
  if (!cred?.endpoint) throw new ProviderConfigError('API key missing: add it in Settings → API Key Vault.');
  return { ...job, options: { ...job.options, _endpoint: { url: endpointBase(cred.endpoint), key: cred.key } } };
}

function webhookUrl(job: Job, scene: Scene) {
  const base = config.publicBaseUrl();
  const secret = config.webhookSecret();
  if (!base.startsWith('https://') || !secret) return undefined;
  const q = new URLSearchParams({ job: job.id, scene: String(scene.idx) });
  if (secret) q.set('token', secret);
  return `${base}/api/webhooks/${job.provider}?${q}`;
}

/** Apply a provider result to a scene (done / failed with auto-retry / still running). */
export async function applyResult(ctx: Ctx, jobId: string, scene: Scene, result: SceneResult) {
  const store = getStore(ctx.db, ctx.userId);
  if (result.status === 'done') {
    await store.updateScene(jobId, scene.idx, { status: 'done', outputUrl: result.outputUrl ?? null, error: null });
  } else if (result.status === 'failed') {
    const retry = scene.attempts < MAX_ATTEMPTS;
    await store.updateScene(jobId, scene.idx, {
      status: retry ? 'queued' : 'failed', error: result.error ?? 'failed',
      externalId: null, meta: null,
    });
  }
}

/**
 * Move a job forward one step: poll running scenes, then submit queued ones up to the parallel limit.
 * Safe to call from the browser poll, a webhook, or a cron at the same time.
 */
const TICK_BUDGET_MS = 35_000;

export async function tick(ctx: Ctx, jobId: string): Promise<Job | null> {
  const startedAt = Date.now();
  const store = getStore(ctx.db, ctx.userId);
  let job = await store.getJob(jobId);
  if (!job) return null;
  if (job.cancelled) return job;
  const provider = getProvider(job.provider);
  const pj = async (j: Job) => withEndpoint(ctx, j);

  // 1) poll running scenes; rescue scenes claimed but never submitted (crashed worker)
  for (const scene of job.scenes.filter((s) => s.status === 'running')) {
    if (!scene.externalId) {
      if (Date.now() - Date.parse(scene.updatedAt) > STALE_CLAIM_MS) await store.updateScene(jobId, scene.idx, { status: 'queued' });
      continue;
    }
    try {
      await applyResult(ctx, jobId, scene, await provider.poll(await pj(job), scene));
    } catch { /* transient network error: try again next tick */ }
  }

  // 2) submit queued scenes
  job = (await store.getJob(jobId))!;
  let running = job.scenes.filter((s) => s.status === 'running').length;
  for (const scene of job.scenes.filter((s) => s.status === 'queued')) {
    if (running >= config.maxParallel()) break;
    if (!(await store.claimScene(jobId, scene.idx))) continue;
    running += 1;
    try {
      const sent = await provider.submit(await pj(job), { ...scene, attempts: scene.attempts + 1 }, { webhookUrl: webhookUrl(job, scene), user: ctx });
      await store.updateScene(jobId, scene.idx, { externalId: sent.externalId, meta: sent.meta ?? null, error: null });
      if (job.provider === 'gtts') {   // synchronous provider: finish this scene now so the next one starts right away (one by one)
        const fresh = (await store.getJob(jobId))?.scenes.find((x) => x.idx === scene.idx);
        if (fresh) await applyResult(ctx, jobId, fresh, await provider.poll(await pj(job), fresh));
        running -= 1;
        if (Date.now() - startedAt > TICK_BUDGET_MS) break;   // the browser's next poll continues where this stopped
      }
    } catch (err) {
      running -= 1;
      await applyResult(ctx, jobId, { ...scene, attempts: scene.attempts + 1 }, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  }
  const final = await store.getJob(jobId);
  if (final) await archiveFinished(ctx, final).catch(() => undefined);   // files outputs into Documents + sends the push, once
  return final;
}

export async function cancelJob(ctx: Ctx, jobId: string) {
  const store = getStore(ctx.db, ctx.userId);
  const job = await store.getJob(jobId);
  if (!job) return null;
  await store.setCancelled(jobId);
  for (const s of job.scenes.filter((x) => x.status === 'queued')) await store.updateScene(jobId, s.idx, { status: 'cancelled' });
  return store.getJob(jobId);
}

export async function retryFailed(ctx: Ctx, jobId: string) {
  const store = getStore(ctx.db, ctx.userId);
  const job = await store.getJob(jobId);
  if (!job || job.cancelled) return job;
  for (const s of job.scenes.filter((x) => x.status === 'failed')) {
    await store.updateScene(jobId, s.idx, { status: 'queued', attempts: 0, error: null, externalId: null, meta: null });
  }
  return tick(ctx, jobId);
}

/**
 * Continue a paused/cancelled job from its first unfinished scene. Finished scenes are kept.
 */
export async function resumeJob(ctx: Ctx, jobId: string) {
  const store = getStore(ctx.db, ctx.userId);
  const job = await store.getJob(jobId);
  if (!job) return null;
  await store.setCancelled(jobId, false);
  for (const s of job.scenes.filter((x) => x.status !== 'done')) {
    await store.updateScene(jobId, s.idx, { status: 'queued', attempts: 0, error: null, externalId: null, meta: null });
  }
  return tick(ctx, jobId);
}
