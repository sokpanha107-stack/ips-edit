import { config } from '../config';
import { composePrompt } from '../prompt';
import { ProviderConfigError, type Provider, type SceneResult } from './types';

/** fal.ai queue API. Model is set by FAL_VIDEO_MODEL (default Wan 2.2 5B image-to-video). */
const BASE = 'https://queue.fal.run';
const headers = () => ({ Authorization: `Key ${config.falKey()}`, 'Content-Type': 'application/json' });

function extractUrl(payload: any): string | undefined { // eslint-disable-line @typescript-eslint/no-explicit-any
  return payload?.video?.url ?? payload?.output?.video?.url ?? payload?.url;
}

export const falProvider: Provider = {
  name: 'fal',
  async submit(job, scene, ctx) {
    if (!config.falKey()) throw new ProviderConfigError('FAL_KEY is not set');
    if (job.engine !== 'video') throw new ProviderConfigError('fal provider only supports the video engine');
    const url = new URL(`${BASE}/${config.falModel()}`);
    if (ctx.webhookUrl) url.searchParams.set('fal_webhook', ctx.webhookUrl);
    const res = await fetch(url, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        prompt: composePrompt(job, scene),
        image_url: job.imageUrl,
        resolution: '720p',
        num_frames: Number(job.options.numFrames) || 121,
        frames_per_second: 24,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.request_id) throw new Error(`fal submit ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return { externalId: data.request_id, meta: { statusUrl: data.status_url, responseUrl: data.response_url } };
  },
  async poll(_job, scene) {
    const statusUrl = scene.meta?.statusUrl as string | undefined;
    const responseUrl = scene.meta?.responseUrl as string | undefined;
    if (!statusUrl || !responseUrl) return { status: 'failed', error: 'missing fal urls' };
    const st = await fetch(statusUrl, { headers: headers() });
    const stData = await st.json().catch(() => ({}));
    if (!st.ok) return { status: 'running' }; // transient, try again next tick
    if (stData.status !== 'COMPLETED') return { status: 'running' };
    const res = await fetch(responseUrl, { headers: headers() });
    const data = await res.json().catch(() => ({}));
    const out = extractUrl(data);
    return out ? { status: 'done', outputUrl: out } : { status: 'failed', error: `fal result ${res.status}: ${JSON.stringify(data).slice(0, 300)}` };
  },
  parseWebhook(body: any): SceneResult { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (body?.status === 'OK') {
      const out = extractUrl(body.payload);
      return out ? { status: 'done', outputUrl: out } : { status: 'failed', error: 'no video url in webhook' };
    }
    if (body?.status === 'ERROR') return { status: 'failed', error: String(body.error ?? 'fal error').slice(0, 300) };
    return { status: 'running' };
  },
};
