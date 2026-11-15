import { config } from '../config';
import { falProvider } from './fal';
import { httpProvider } from './http';
import { mockProvider } from './mock';
import { runpodProvider } from './runpod';
import { ProviderConfigError, type Provider } from './types';

const registry: Record<string, Provider> = { mock: mockProvider, fal: falProvider, runpod: runpodProvider, http: httpProvider };

export function getProvider(name: string): Provider {
  const p = registry[name];
  if (!p) throw new ProviderConfigError(`Unknown provider "${name}". Use one of: ${Object.keys(registry).join(', ')}`);
  return p;
}

export function providerFor(engine: 'video' | 'kh' | 'en') {
  return engine === 'video' ? config.videoProvider() : config.voiceProvider();
}

export { ProviderConfigError };
export type { Provider, SceneResult } from './types';
