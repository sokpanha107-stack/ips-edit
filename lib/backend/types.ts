export type Engine = 'video' | 'kh' | 'en';
export type SceneStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type JobStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface Scene {
  jobId: string;
  idx: number;
  prompt: string;
  status: SceneStatus;
  externalId?: string;
  meta?: Record<string, unknown>;
  outputUrl?: string;
  error?: string;
  attempts: number;
  updatedAt: string;
}

export interface Job {
  id: string;
  engine: Engine;
  folder: string;
  masterPrompt: string;
  provider: string;
  imageUrl?: string;
  voiceId?: string;
  options: Record<string, unknown>;
  cancelled: boolean;
  createdAt: string;
  updatedAt: string;
  scenes: Scene[];
}

export interface JobView extends Omit<Job, 'imageUrl'> {
  status: JobStatus;
  progress: { total: number; done: number; failed: number; running: number };
}

/** Derive the job status from its scenes. */
export function deriveStatus(job: Pick<Job, 'scenes' | 'cancelled'>): JobStatus {
  const s = job.scenes;
  if (job.cancelled) return 'cancelled';
  if (s.length === 0) return 'queued';
  const done = s.filter((x) => x.status === 'done').length;
  const failed = s.filter((x) => x.status === 'failed').length;
  const running = s.filter((x) => x.status === 'running').length;
  const finished = done + failed + s.filter((x) => x.status === 'cancelled').length;
  if (finished < s.length) return running > 0 || done > 0 || failed > 0 ? 'running' : 'queued';
  if (failed === 0) return 'completed';
  return done > 0 ? 'partial' : 'failed';
}

export function toView(job: Job): JobView {
  const { imageUrl: _omit, ...rest } = job;
  void _omit;
  const scenes = job.scenes;
  return {
    ...rest,
    status: deriveStatus(job),
    progress: {
      total: scenes.length,
      done: scenes.filter((x) => x.status === 'done').length,
      failed: scenes.filter((x) => x.status === 'failed').length,
      running: scenes.filter((x) => x.status === 'running').length,
    },
  };
}
