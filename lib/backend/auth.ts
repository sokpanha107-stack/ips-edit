import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { config } from './config';

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Returns an error response if the request is not allowed, otherwise null. */
export function requireAccess(req: Request): NextResponse | null {
  const key = config.accessKey();
  if (!key) return null; // open mode (local dev). /api/health reports this.
  const sent = req.headers.get('x-ips-key') ?? '';
  if (!same(sent, key)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return null;
}

export function checkWebhookToken(token: string | null) {
  const secret = config.webhookSecret();
  if (!secret) return true;
  return !!token && same(token, secret);
}
