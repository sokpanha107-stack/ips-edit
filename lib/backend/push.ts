import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';

export const pushConfigured = () => !!config.vapidPublic() && !!config.vapidPrivate();
let ready = false;
function init() {
  if (ready) return true;
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(config.vapidSubject(), config.vapidPublic(), config.vapidPrivate());
  return (ready = true);
}

export interface PushMessage { title: string; body: string; url?: string; tag?: string }

/** Sends a native Web Push to every device this user subscribed. Dead subscriptions (404/410) are removed. Never throws. */
export async function notifyUser(db: SupabaseClient, userId: string, msg: PushMessage): Promise<number> {
  if (!init()) return 0;
  const { data } = await db.from('push_subscriptions').select('id,subscription').eq('user_id', userId);
  let sent = 0;
  await Promise.all((data ?? []).map(async (row: { id: string; subscription: webpush.PushSubscription }) => {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({ url: '/', ...msg }), { TTL: 3600 });
      sent += 1;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', row.id).eq('user_id', userId);
    }
  }));
  return sent;
}
