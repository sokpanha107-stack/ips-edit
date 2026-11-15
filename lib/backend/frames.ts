import type { Job, Scene } from './types';

/** Audio length (seconds) the user measured in the browser for this scene, if any. */
export function audioSecondsFor(job: Job, scene: Scene): number | undefined {
  const list = job.options.sceneSeconds;
  const v = Array.isArray(list) ? Number(list[scene.idx]) : NaN;
  return Number.isFinite(v) && v > 0 ? Math.min(v, 600) : undefined;
}

/** Options sent to the GPU worker: no secrets, no per-scene array, plus this scene's audio_seconds (the worker turns it into a frame count). */
export function workerOptions(job: Job, scene: Scene): Record<string, unknown> {
  const { _endpoint, sceneSeconds, ...rest } = job.options;
  void _endpoint; void sceneSeconds;
  const secs = audioSecondsFor(job, scene);
  return { ...rest, ...(secs ? { audio_seconds: secs } : {}) };
}

/** Wan frame counts are 4n+1 at 24 fps. */
export function framesForSeconds(seconds: number, min: number, max: number, fps = 24) {
  return Math.max(min, Math.min(max, Math.round((seconds * fps) / 4) * 4 + 1));
}
