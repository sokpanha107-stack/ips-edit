import { config } from '../config';
import { workerOptions } from '../frames';
import { composePrompt } from '../prompt';
import { ProviderConfigError, type Provider, type SceneResult } from './types';

/**
 * RunPod Serverless endpoint (your own worker running Wan2.2 / VoxCPM2 ...).
 * Contract with the worker:
 *   input  = { engine, job_id, prompt, image (data URL), voice_id, scene, options }
 *   output = { url } | { video_url } | { audio_url } | "https://..."
 */
const endpointFor = (engine: string) => (engine === 'video' ? config.runpodVideoEndpoint() : config.runpodVoiceEndpoint());
const headers = () => ({ Authorization: `Bearer ${config.runpodKey()}`, 'Content-Type': 'application/json' });

function outputUrl(out: any): string | undefined { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (typeof out === 'string') return out;
  return out?.url ?? out?.video_url ?? out?.audio_url;
}
export function toResult(status: string, output: any, error?: unknown): SceneResult { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (status === 'COMPLETED') {
    const url = outputUrl(output);
    return url ? { status: 'done', outputUrl: url } : { status: 'failed', error: 'worker returned no url' };
  }
  if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') return { status: 'failed', error: String(error ?? status).slice(0, 300) };
  return { status: 'running' };
}

export const runpodProvider: Provider = {
  name: 'runpod',
  async submit(job, scene, ctx) {
    const endpoint = endpointFor(job.engine);
    if (!config.runpodKey() || !endpoint) throw new ProviderConfigError('RUNPOD_API_KEY and the endpoint id for this engine must be set');
    const res = await fetch(`https://api.runpod.ai/v2/${endpoint}/run`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        input: { engine: job.engine, job_id: job.id, prompt: composePrompt(job, scene), image: job.imageUrl, voice_id: job.voiceId, scene: scene.idx, options: workerOptions(job, scene) },
        ...(ctx.webhookUrl ? { webhook: ctx.webhookUrl } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) throw new Error(`runpod submit ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return { externalId: data.id, meta: { endpoint } };
  },
  async poll(job, scene) {
    const endpoint = (scene.meta?.endpoint as string) || endpointFor(job.engine);
    const res = await fetch(`https://api.runpod.ai/v2/${endpoint}/status/${scene.externalId}`, { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 'running' };
    return toResult(data.status, data.output, data.error);
  },
  parseWebhook(body: any): SceneResult { // eslint-disable-line @typescript-eslint/no-explicit-any
    return toResult(body?.status, body?.output, body?.error);
  },
};
