import { createHmac, timingSafeEqual } from 'crypto';

/** One-time job token for the Music Engine: lets the RunPod worker finish ONE upload for ONE user without ever holding a Supabase key. */
/** u user · p storage path (or path PREFIX for multi-file jobs) · n file name · t display title · f Document folder id · j gpu_jobs id · e expiry */
export interface MusicClaims { u: string; p: string; n: string; e: number; t?: string; f?: string; j?: string }

const secret = () => (process.env.MUSIC_TOKEN_SECRET || process.env.VAULT_ENCRYPTION_KEY || '').trim();
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const sign = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');

export const musicTokenReady = () => secret().length >= 16;

export function makeMusicToken(c: Omit<MusicClaims, 'e'>, ttlSec = 3 * 3600): string {
  const body = b64(JSON.stringify({ ...c, e: Math.floor(Date.now() / 1000) + ttlSec } satisfies MusicClaims));
  return `${body}.${sign(body)}`;
}

export function readMusicToken(token: string): MusicClaims | null {
  if (!musicTokenReady()) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try { const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as MusicClaims; return c.e > Date.now() / 1000 && c.u && c.p && c.n ? c : null; } catch { return null; }
}
