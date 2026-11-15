import type { Job, Scene } from './types';

/** Master prompt + the scene's own line. This is also where the Emotion Director will plug in later. */
export function composePrompt(job: Job, scene: Scene): string {
  return [job.masterPrompt.trim(), scene.prompt.trim()].filter(Boolean).join('\n');
}
