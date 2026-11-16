import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';
import { fetchJson, normalizeBase } from './endpoint';

export type Service = 'runpod' | 'voice_api';
export const SERVICES: Service[] = ['runpod', 'voice_api'];

/* ---------- AES-256-GCM: the database only ever holds ciphertext ---------- */
function secretKey(): Buffer {
  const s = config.vaultSecret();
  if (s.length < 24) throw new Error('VAULT_ENCRYPTION_KEY is not set on the server (min. 24 characters). Add it in Vercel → Environment Variables.');
  return createHash('sha256').update(s).digest();
}
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', secretKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}
export function decrypt(cipher: string): string {
  const [v, iv, tag, ct] = cipher.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Stored key is corrupted');
  const d = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

/** RunPod users may paste just the endpoint ID; turn it into the API base URL. Anything else must be a public https URL. */
export function endpointBase(raw: string): string {
  const v = raw.trim();
  if (/^[a-z0-9]{8,32}$/i.test(v)) return `https://api.runpod.ai/v2/${v}`;
  return normalizeBase(v);
}

export interface Credential { key: string; endpoint: string }
export interface VaultStatus { service: Service; hasKey: boolean; hint: string; endpoint: string | null; status: 'connected' | 'failed' | null; checkedAt: string | null }

type Row = { service_name: Service; key_cipher: string; key_hint: string; endpoint: string | null; last_status: 'connected' | 'failed' | null; last_checked_at: string | null };
const COLS = 'service_name,key_cipher,key_hint,endpoint,last_status,last_checked_at';

/** Masked view for the UI: the real key is never sent back to the browser. */
export async function listVault(db: SupabaseClient): Promise<VaultStatus[]> {
  const { data, error } = await db.from('api_keys').select(COLS);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  return SERVICES.map((service) => {
    const r = rows.find((x) => x.service_name === service);
    return { service, hasKey: !!r, hint: r?.key_hint ?? '', endpoint: r?.endpoint ?? null, status: r?.last_status ?? null, checkedAt: r?.last_checked_at ?? null };
  });
}

/** Decrypted credential for server-side use only. */
export async function getCredential(db: SupabaseClient, userId: string, service: Service): Promise<Credential | null> {
  const { data, error } = await db.from('api_keys').select(COLS).eq('user_id', userId).eq('service_name', service).maybeSingle();
  if (error) throw new Error(error.message);
  const r = data as Row | null;
  if (!r) return null;
  return { key: decrypt(r.key_cipher), endpoint: r.endpoint ?? '' };
}

export async function saveCredential(db: SupabaseClient, userId: string, service: Service, key: string | undefined, endpoint: string | undefined): Promise<Credential> {
  const existing = await getCredential(db, userId, service);
  const finalKey = key?.trim() || existing?.key;
  if (!finalKey) throw new Error('Enter an API key.');
  const finalEndpoint = endpoint !== undefined ? endpoint.trim() : existing?.endpoint ?? '';
  const row = { user_id: userId, service_name: service, key_cipher: encrypt(finalKey), key_hint: `••••${finalKey.slice(-4)}`, endpoint: finalEndpoint || null, last_status: null, last_checked_at: null, updated_at: new Date().toISOString() };
  const { error } = await db.from('api_keys').upsert(row, { onConflict: 'user_id,service_name' });
  if (error) throw new Error(error.message);
  return { key: finalKey, endpoint: finalEndpoint };
}

export async function deleteCredential(db: SupabaseClient, userId: string, service: Service) {
  const { error } = await db.from('api_keys').delete().eq('user_id', userId).eq('service_name', service);
  if (error) throw new Error(error.message);
}

export async function recordStatus(db: SupabaseClient, userId: string, service: Service, ok: boolean) {
  await db.from('api_keys').update({ last_status: ok ? 'connected' : 'failed', last_checked_at: new Date().toISOString() }).eq('user_id', userId).eq('service_name', service);
}

/** Live check. RunPod: endpoint /health, or (no endpoint yet) a key check against RunPod's API. Voice API: the worker's /health or /hardware. */
export async function testCredential(service: Service, cred: Credential): Promise<{ ok: boolean; message: string }> {
  try {
    const auth = { Authorization: `Bearer ${cred.key}` };
    if (service === 'runpod' && !cred.endpoint) {
      const r = await fetchJson('https://api.runpod.io/graphql', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ myself { id } }' }) });
      return r.ok && r.data?.data?.myself?.id ? { ok: true, message: 'RunPod key accepted. Add the Endpoint ID to use it for video.' } : { ok: false, message: 'RunPod rejected this key.' };
    }
    if (!cred.endpoint) return { ok: false, message: 'Enter the endpoint URL.' };
    const base = endpointBase(cred.endpoint);
    const health = await fetchJson(`${base}/health`, { headers: auth });
    if (health.status === 401 || health.status === 403) return { ok: false, message: 'The server rejected the key.' };
    if (health.ok) return { ok: true, message: 'Connected.' };
    const hw = await fetchJson(`${base}/hardware`, { headers: auth }).catch(() => null);
    if (hw?.ok) return { ok: true, message: 'Connected.' };
    return { ok: false, message: `Could not reach the endpoint (${health.status}). Check the URL / endpoint ID.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error && e.name === 'AbortError' ? 'The server did not answer in time.' : e instanceof Error ? e.message : 'Could not connect.' };
  }
}

export const serviceFor = (engine: 'video' | 'kh' | 'en'): Service => (engine === 'video' ? 'runpod' : 'voice_api');
