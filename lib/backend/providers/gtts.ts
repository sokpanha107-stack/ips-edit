import { config } from '../config';
import { ProviderConfigError, type Provider } from './types';

/**
 * FREE voice (no API key): the Python function /api/py/tts runs gTTS. The audio is saved straight into the user's private
 * Storage folder; the scene's output is "storage://<path>" and is filed into Documents when the job completes.
 * Synchronous by nature: submit() does the work, poll() just reports it.
 */
export const gttsProvider: Provider = {
  name: 'gtts',
  async submit(job, scene, ctx) {
    if (!ctx.user.accessToken) throw new ProviderConfigError('No session token for the free voice tool.');
    const res = await fetch(`${config.pythonBase()}/tts`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.user.accessToken}` },
      body: JSON.stringify({ text: scene.prompt, lang: job.engine === 'kh' ? 'km' : 'en' }),
    });
    if (!res.ok) throw new Error(`free voice tool ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const path = `${ctx.user.userId}/jobs/${job.id}/scene-${String(scene.idx + 1).padStart(2, '0')}.mp3`;
    const up = await ctx.user.db.storage.from('documents').upload(path, bytes, { contentType: 'audio/mpeg', upsert: true });
    if (up.error) throw new Error(`storage: ${up.error.message}`);
    return { externalId: `gtts-${scene.idx}`, meta: { outputUrl: `storage://${path}` } };
  },
  async poll(_job, scene) {
    const url = scene.meta?.outputUrl;
    return typeof url === 'string' ? { status: 'done', outputUrl: url } : { status: 'failed', error: 'no audio produced' };
  },
};
