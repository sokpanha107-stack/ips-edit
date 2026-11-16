'use client';

import { useEffect, useState } from 'react';
import { Fingerprint, Loader2, LogOut } from 'lucide-react';
import { browserClient } from '@/lib/supabase/browser';
import { PushToggle } from './push-toggle';

export function AccountPanel() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'' | 'pk' | 'out'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { browserClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? '')).catch(() => undefined); }, []);

  const addPasskey = async () => {
    setBusy('pk'); setMsg(null);
    try {
      const { error } = await browserClient().auth.registerPasskey();
      if (error) throw error;
      setMsg({ ok: true, text: 'Passkey added. Next time use "Sign in with Passkey".' });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error && e.message ? e.message : 'Passkey was cancelled.' }); }
    setBusy('');
  };
  const signOut = async () => {
    setBusy('out');
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }).catch(() => undefined); await sub.unsubscribe().catch(() => undefined); }
      if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));   // nothing of this account stays on the device
    } catch { /* best effort */ }
    await browserClient().auth.signOut();
    window.location.assign('/login');
  };

  return <div className="space-y-3 text-zinc-100">
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Signed in as</p>
      <p className="mt-1 break-all text-sm">{email || '…'}</p>
      <div className="mt-3 grid gap-2">
        <button type="button" onClick={addPasskey} disabled={!!busy} className="flex items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-60">
          {busy === 'pk' ? <Loader2 size={15} className="animate-spin" /> : <Fingerprint size={15} />} Add a passkey on this device
        </button>
        <button type="button" onClick={signOut} disabled={!!busy} className="flex items-center justify-center gap-2 rounded-lg border border-zinc-800 px-3 py-2.5 text-sm text-zinc-300 hover:border-red-500/50 hover:text-red-300 disabled:opacity-60">
          {busy === 'out' ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />} Sign out
        </button>
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </section>
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Notifications</p><PushToggle /></section>
  </div>;
}
