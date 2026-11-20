import { createHmac, timingSafeEqual } from 'crypto';

/** Short-lived browser -> GPU job token. HMAC-SHA256 keyed with the user's Atom GPU secret (the ATOM_KEY on the Pod), so the raw key never reaches the browser. */
export interface GpuClaims { e: number; s: 'browser'; u: string }
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('base64url');

export function mintGpuToken(secret: string, userId: string, ttlSec = 3600): { token: string; exp: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = b64(JSON.stringify({ e: exp, s: 'browser', u: userId } satisfies GpuClaims));
  return { token: `${body}.${mac(secret, body)}`, exp };
}
export function verifyGpuToken(secret: string, token: string): GpuClaims | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(mac(secret, body)), b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as GpuClaims; return c.e > Date.now() / 1000 ? c : null; } catch { return null; }
}
