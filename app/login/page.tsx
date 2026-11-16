'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Fingerprint, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { browserClient } from '@/lib/supabase/browser';
import { supabaseConfigured } from '@/lib/supabase/env';

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" /><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.500 42.600 14.600 48 24 48z" /></svg>;
}

function LoginCard() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const [busy, setBusy] = useState<'' | 'google' | 'passkey' | 'email'>('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(params.get('error') ? { ok: false, text: 'Sign-in failed. Please try again.' } : null);
  const configured = supabaseConfigured();
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const callback = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;

  const google = async () => {
    setBusy('google'); setMsg(null);
    const { error } = await browserClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callback() } });
    if (error) { setMsg({ ok: false, text: error.message }); setBusy(''); }
  };
  const passkey = async () => {
    setBusy('passkey'); setMsg(null);
    try {
      const { error } = await browserClient().auth.signInWithPasskey();
      if (error) throw error;
      window.location.assign(safeNext);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error && e.message ? e.message : 'Passkey sign-in was cancelled or no passkey is registered on this device.' });
      setBusy('');
    }
  };
  const magic = async (e: React.FormEvent) => {
    e.preventDefault(); if (!email.trim()) return;
    setBusy('email'); setMsg(null);
    const { error } = await browserClient().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callback() } });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Check your email: open the link on this device to enter.' });
    setBusy('');
  };

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40 shadow-[0_0_40px_rgba(245,158,11,.25)]"><ShieldCheck size={28} /></div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-amber-400/80">Control Center</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-zinc-50">IPS Edit</h1>
        <p className="mt-2 text-sm text-zinc-400">Private workspace. Sign in to continue.</p>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/50 backdrop-blur">
        {!configured && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">Server is missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.</p>}
        <button type="button" onClick={google} disabled={!configured || !!busy} className="flex w-full items-center justify-center gap-3 rounded-xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-white disabled:opacity-50">
          {busy === 'google' ? <Loader2 size={18} className="animate-spin" /> : <GoogleMark />} Continue with Google
        </button>
        <button type="button" onClick={passkey} disabled={!configured || !!busy} className="mt-3 flex w-full items-center justify-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50">
          {busy === 'passkey' ? <Loader2 size={18} className="animate-spin" /> : <Fingerprint size={18} />} Sign in with Passkey
        </button>

        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-widest text-zinc-600"><span className="h-px flex-1 bg-zinc-800" />or email link<span className="h-px flex-1 bg-zinc-800" /></div>
        <form onSubmit={magic} className="flex gap-2">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" autoComplete="email"
            className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-500/60" />
          <button type="submit" disabled={!configured || !!busy} className="grid w-12 place-items-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-300 hover:text-amber-300 disabled:opacity-50" aria-label="Send sign-in link">
            {busy === 'email' ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
          </button>
        </form>
        {msg && <p className={`mt-4 rounded-lg border p-3 text-xs ${msg.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>{msg.text}</p>}
      </div>
      <p className="mt-6 text-center text-xs text-zinc-600">No passwords. Your data is isolated to your account.</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen min-h-[100dvh] place-items-center bg-zinc-950 font-sans bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,.10),transparent_60%)] px-4 py-10">
      <Suspense fallback={null}><LoginCard /></Suspense>
    </main>
  );
}
