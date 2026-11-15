import type { Provider } from './types';

/** Works with no keys. Stateless: the finish time is encoded in the external id. */
export const mockProvider: Provider = {
  name: 'mock',
  async submit(_job, scene) {
    const finishAt = Date.now() + 3000 + (scene.idx % 5) * 800;
    return { externalId: `mock:${finishAt}` };
  },
  async poll(job, scene) {
    const finishAt = Number(scene.externalId?.split(':')[1] ?? 0);
    if (Date.now() < finishAt) return { status: 'running' };
    return { status: 'done', outputUrl: `mock://${job.folder}/scene-${String(scene.idx + 1).padStart(2, '0')}` };
  },
};
