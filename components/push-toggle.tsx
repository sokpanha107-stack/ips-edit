'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Asks for notification permission and saves this device's PushSubscription (via /api/push → table push_subscriptions). */
export function PushToggle() {
  const [supported, setSupported] = useState(true);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setSupported(false); return; }
    const reg = await navigator.serviceWorker.getRegistration();
    setOn(!!(await reg?.pushManager.getSubscription()) && Notification.permission === 'granted');
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const enable = async () => {
    setBusy(true); setMsg('');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in the browser / phone settings.');
      const info = await (await fetch('/api/push', { cache: 'no-store' })).json();
      if (!info.configured || !info.publicKey) throw new Error('Push is not configured on the server (VAPID keys missing).');
      const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(info.publicKey) });
      const res = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not save this device.');
      setOn(true); setMsg('Notifications are on for this device.');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
    setBusy(false);
  };
  const disable = async () => {
    setBusy(true); setMsg('');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }); await sub.unsubscribe(); }
      setOn(false);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
    setBusy(false);
  };

  if (!supported) return <p className="text-xs text-zinc-500">This browser cannot receive push notifications. On iPhone: Share → Add to Home Screen, then open the app from the Home Screen.</p>;
  return <div>
    <button type="button" onClick={on ? disable : enable} disabled={busy} className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${on ? 'border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-red-500/50' : 'bg-amber-500 text-zinc-950 hover:bg-amber-400'}`}>
      {busy ? <Loader2 size={15} className="animate-spin" /> : on ? <BellOff size={15} /> : <Bell size={15} />} {on ? 'Turn off notifications on this device' : 'Turn on job notifications'}
    </button>
    {msg && <p className="mt-2 text-xs text-zinc-400">{msg}</p>}
    <p className="mt-2 text-[11px] text-zinc-600">You get a push when an image, voice or video job finishes, even if the app is closed. iPhone needs the app added to the Home Screen.</p>
  </div>;
}
