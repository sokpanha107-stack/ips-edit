import { timingSafeEqual } from 'crypto';
import { config } from './config';

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Webhooks have no user session, so they must carry WEBHOOK_SECRET. No secret configured = webhooks are refused (polling still works). */
export function checkWebhookToken(token: string | null) {
  const secret = config.webhookSecret();
  return !!secret && !!token && same(token, secret);
}
