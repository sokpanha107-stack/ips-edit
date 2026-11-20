import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyUser } from './push';
import { getCredential } from './vault';

/** Web Push to every subscribed device AND (if configured in the Vault) a Telegram message, which reliably reaches a locked iPhone. Never throws. */
export async function notifyAll(db: SupabaseClient, userId: string, title: string, text: string, tag: string) {
  await notifyUser(db, userId, { title, body: text, url: '/?tab=documents', tag }).catch(() => 0);
  try {
    const t = await getCredential(db, userId, 'telegram');
    if (t?.key && /^-?\d{5,20}$/.test(t.endpoint.trim()))
      await fetch(`https://api.telegram.org/bot${encodeURIComponent(t.key)}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: t.endpoint.trim(), text: `${title}\n${text}` }), signal: AbortSignal.timeout(10000) });
  } catch { /* alerts are best-effort */ }
}
