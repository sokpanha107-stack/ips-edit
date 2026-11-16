import { gttsProvider } from './gtts';
import { httpProvider } from './http';
import { ProviderConfigError, type Provider } from './types';

/** http = the user's own GPU worker (RunPod / Colab) using the key in their API Key Vault. gtts = free Python voice (no key). */
const registry: Record<string, Provider> = { http: httpProvider, gtts: gttsProvider };

export function getProvider(name: string): Provider {
  const p = registry[name];
  if (!p) throw new ProviderConfigError(`Unknown provider "${name}".`);
  return p;
}

export { ProviderConfigError };
export type { Provider, SceneResult } from './types';
