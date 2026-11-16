import type { SceneResult } from './types';

/**
 * RunPod-style worker contract (used by the generic http provider; the key comes from the user's API Key Vault, never from .env).
 * Contract with the worker:
 *   input  = { engine, job_id, prompt, image (data URL), voice_id, scene, options }
 *   output = { url } | { video_url } | { audio_url } | "https://..."
 */
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

