import { authHeaders, normalizeBase, type Endpoint } from '../endpoint';
import { composePrompt } from '../prompt';
import { ProviderConfigError, type Provider } from './types';
import { toResult } from './runpod';

/**
 * Generic "bring your own GPU" provider. The endpoint (URL + key) comes from the Command Center and is stored with the job.
 * Works with anything that follows the RunPod-style contract:
 *   POST {base}/run            { input, webhook? } -> { id }
 *   GET  {base}/status/{id}    -> { status: COMPLETED|FAILED|IN_QUEUE|IN_PROGRESS, output: { url }, error? }
 *   GET  {base}/hardware       -> { gpu, vram_total_gb, vram_used_gb, disk_total_gb, disk_used_gb, model }   (optional, Colab-style servers)
 * RunPod Serverless is exactly this contract with base = https://api.runpod.ai/v2/<endpoint id>.
 */
function endpointOf(options: Record<string, unknown>): Endpoint {
  const ep = options._endpoint as Endpoint | undefined;
  if (!ep?.url) throw new ProviderConfigError('No GPU endpoint set. Open Command Center, enter the Video Engine URL and press Connect.');
  return { url: normalizeBase(ep.url), key: ep.key };
}
const publicOptions = ({ _endpoint, ...rest }: Record<string, unknown>) => { void _endpoint; return rest; };

export const httpProvider: Provider = {
  name: 'http',
  async submit(job, scene, ctx) {
    const ep = endpointOf(job.options);
    const res = await fetch(`${ep.url}/run`, {
      method: 'POST', headers: authHeaders(ep),
      body: JSON.stringify({
        input: { engine: job.engine, job_id: job.id, prompt: composePrompt(job, scene), image: job.imageUrl, voice_id: job.voiceId, scene: scene.idx, options: publicOptions(job.options) },
        ...(ctx.webhookUrl ? { webhook: ctx.webhookUrl } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) throw new Error(`worker submit ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return { externalId: String(data.id) };
  },
  async poll(job, scene) {
    const ep = endpointOf(job.options);
    const res = await fetch(`${ep.url}/status/${scene.externalId}`, { headers: authHeaders(ep), cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 'running' };
    return toResult(data.status, data.output, data.error);
  },
  parseWebhook(body: any) { return toResult(body?.status, body?.output, body?.error); }, // eslint-disable-line @typescript-eslint/no-explicit-any
};
