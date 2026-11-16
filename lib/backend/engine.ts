import { randomUUID } from 'crypto';
import { config } from './config';
import { getProvider, providerFor } from './providers';
import { getStore } from './store';
import type { Job, Scene } from './types';
import type { SceneResult } from './providers/types';
import { normalizeBase, type Endpoint } from './endpoint';

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
  /** User-supplied GPU worker (Command Center). Used for video jobs instead of VIDEO_PROVIDER. */
  endpoint?: Endpoint;
}

export async function createJob(input: NewJob): Promise<Job> {
  if (input.scenes.length > config.maxScenes()) throw new Error(`Too many scenes (max ${config.maxScenes()})`);
  const useEndpoint = !!input.endpoint?.url;
  const provider = useEndpoint ? 'http' : providerFor(input.engine);
  getProvider(provider); // throws if unknown
  if (provider === 'http' && !useEndpoint) throw new Error(input.engine === 'video' ? 'Video Engine is not connected. Open Command Center, enter the Video Engine URL and press Connect.' : 'Voice Engine is not connected. Open Command Center, enter the Voice Engine URL and press Connect.');
  const ts = new Date().toISOString();
  const job: Job = {
    id: randomUUID(), engine: input.engine, folder: input.folder, masterPrompt: input.masterPrompt, provider,
    imageUrl: input.imageDataUrl, voiceId: input.voiceId, options: { ...(input.options ?? {}), ...(useEndpoint ? { _endpoint: { url: normalizeBase(input.endpoint!.url), key: input.endpoint!.key } } : {}) }, cancelled: false,
    createdAt: ts, updatedAt: ts,
    scenes: input.scenes.map((prompt, idx): Scene => ({ jobId: '', idx, prompt, status: 'queued', attempts: 0, updatedAt: ts })),
  };
  job.scenes.forEach((s) => { s.jobId = job.id; });
  await getStore().createJob(job);
  return job;
}

function webhookUrl(job: Job, scene: Scene) {
  const base = config.publicBaseUrl();
  if (!base.startsWith('https://')) return undefined;
  const secret = config.webhookSecret();
  const q = new URLSearchParams({ job: job.id, scene: String(scene.idx) });
  if (secret) q.set('token', secret);
  return `${base}/api/webhooks/${job.provider}?${q}`;
}

/** Apply a provider result to a scene (done / failed with auto-retry / still running). */
export async function applyResult(jobId: string, scene: Scene, result: SceneResult) {
  const store = getStore();
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
export async function tick(jobId: string): Promise<Job | null> {
  const store = getStore();
  let job = await store.getJob(jobId);
  if (!job) return null;
  if (job.cancelled) return job;
  const provider = getProvider(job.provider);

  // 1) poll running scenes; rescue scenes claimed but never submitted (crashed worker)
  for (const scene of job.scenes.filter((s) => s.status === 'running')) {
    if (!scene.externalId) {
      if (Date.now() - Date.parse(scene.updatedAt) > STALE_CLAIM_MS) await store.updateScene(jobId, scene.idx, { status: 'queued' });
      continue;
    }
    try {
      await applyResult(jobId, scene, await provider.poll(job, scene));
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
      const sent = await provider.submit(job, { ...scene, attempts: scene.attempts + 1 }, { webhookUrl: webhookUrl(job, scene) });
      await store.updateScene(jobId, scene.idx, { externalId: sent.externalId, meta: sent.meta ?? null, error: null });
    } catch (err) {
      running -= 1;
      await applyResult(jobId, { ...scene, attempts: scene.attempts + 1 }, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  }
  return store.getJob(jobId);
}

export async function cancelJob(jobId: string) {
  const store = getStore();
  const job = await store.getJob(jobId);
  if (!job) return null;
  await store.setCancelled(jobId);
  for (const s of job.scenes.filter((x) => x.status === 'queued')) await store.updateScene(jobId, s.idx, { status: 'cancelled' });
  return store.getJob(jobId);
}

export async function retryFailed(jobId: string) {
  const store = getStore();
  const job = await store.getJob(jobId);
  if (!job || job.cancelled) return job;
  for (const s of job.scenes.filter((x) => x.status === 'failed')) {
    await store.updateScene(jobId, s.idx, { status: 'queued', attempts: 0, error: null, externalId: null, meta: null });
  }
  return tick(jobId);
}

/**
 * Continue a paused/cancelled job from its first unfinished scene. Finished scenes are kept.
 * A new endpoint may be passed (a new Colab session has a new URL).
 */
export async function resumeJob(jobId: string, endpoint?: Endpoint) {
  const store = getStore();
  const job = await store.getJob(jobId);
  if (!job) return null;
  if (endpoint?.url && job.provider === 'http') {
    await store.updateOptions(jobId, { ...job.options, _endpoint: { url: normalizeBase(endpoint.url), key: endpoint.key } });
  }
  await store.setCancelled(jobId, false);
  for (const s of job.scenes.filter((x) => x.status !== 'done')) {
    await store.updateScene(jobId, s.idx, { status: 'queued', attempts: 0, error: null, externalId: null, meta: null });
  }
  return tick(jobId);
}
