import type { Job, Scene } from '../types';

export interface SceneResult {
  status: 'running' | 'done' | 'failed';
  outputUrl?: string;
  error?: string;
}

export interface SubmitContext {
  /** Public URL the provider should call when the scene finishes (may be empty). */
  webhookUrl?: string;
}

/** Every GPU/API backend implements this. Swapping provider = changing VIDEO_PROVIDER / VOICE_PROVIDER. */
export interface Provider {
  readonly name: string;
  submit(job: Job, scene: Scene, ctx: SubmitContext): Promise<{ externalId: string; meta?: Record<string, unknown> }>;
  poll(job: Job, scene: Scene): Promise<SceneResult>;
  /** Translate the provider's webhook body into a result. */
  parseWebhook?(body: unknown): SceneResult;
}

export class ProviderConfigError extends Error {}
