'use client';

import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, PlugZap, Trash2 } from 'lucide-react';
import { api, type VaultService } from '@/lib/client/api';

const INFO = {
  runpod: { title: 'RunPod GPU', help: 'Runs Video Engine jobs on your own GPU. Paste your RunPod API key and the Endpoint ID (or its https URL).', endpointLabel: 'Endpoint ID or URL', endpointPh: 'e.g. abc123xyz or https://api.runpod.ai/v2/abc123xyz', required: 'Needed for: Video Engine' },
  voice_api: { title: 'Premium Voice', help: 'Optional. Your own voice server (e.g. a Khmer voice-clone worker). Without it, the free gTTS voice is used automatically.', endpointLabel: 'Voice server URL', endpointPh: 'https://your-voice-server.example.com', required: 'Optional: premium voice quality' },
} as const;

function Card({ s, onChange }: { s: VaultService; onChange: (v: VaultService[]) => void }) {
  const info = INFO[s.service];
  const [key, setKey] = useState('');
  const [endpoint, setEndpoint] = useState(s.endpoint ?? '');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.saveVault(s.service, key, endpoint);
      setKey(''); setShow(false); onChange(r.services); setMsg({ ok: r.ok, text: r.message });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed' }); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    try { onChange((await api.deleteVault(s.service)).services); setEndpoint(''); setKey(''); setMsg(null); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed' }); }
    setBusy(false);
  };
  const pill = s.status === 'connected' ? { t: '🟢 Connected', c: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' }
    : s.status === 'failed' ? { t: '🔴 Failed', c: 'border-red-500/40 bg-red-500/10 text-red-300' }
    : s.hasKey ? { t: '⚪ Not tested', c: 'border-zinc-700 bg-zinc-800 text-zinc-300' } : { t: '⚪ Not set', c: 'border-zinc-800 bg-zinc-900 text-zinc-500' };

  return <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-zinc-100">
    <div className="flex items-center gap-2">
      <KeyRound size={16} className="text-amber-400" /><h4 className="text-sm font-semibold">{info.title}</h4>
      <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${pill.c}`}>{pill.t}</span>
    </div>
    <p className="mt-1 text-xs leading-relaxed text-zinc-400">{info.help}</p>
    <p className="mt-1 text-[11px] text-amber-400/80">{info.required}</p>

    <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">API key</label>
    <div className="mt-1 flex gap-2">
      <input type={show ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false}
        placeholder={s.hasKey ? `Saved ${s.hint}. Leave empty to keep it` : 'Paste key'}
        className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-amber-500/60" />
      <button type="button" onClick={() => setShow((v) => !v)} className="grid w-10 place-items-center rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-100" aria-label={show ? 'Hide key' : 'Show key'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div>

    <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{info.endpointLabel}</label>
    <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder={info.endpointPh}
      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-amber-500/60" />

    <div className="mt-3 flex gap-2">
      <button type="button" onClick={save} disabled={busy || (!key && !s.hasKey)} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />} Save &amp; Test Connection
      </button>
      {s.hasKey && <button type="button" onClick={remove} disabled={busy} className="grid w-11 place-items-center rounded-lg border border-zinc-800 text-zinc-400 hover:border-red-500/50 hover:text-red-400" aria-label="Remove key"><Trash2 size={16} /></button>}
    </div>
    {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    <p className="mt-2 text-[11px] text-zinc-600">Stored encrypted. The key is never sent back to this screen.</p>
  </section>;
}

export function ApiKeyVault({ services, error, onChange }: { services: VaultService[] | null; error?: string; onChange: (v: VaultService[]) => void }) {
  if (!services) return <p className="text-xs text-zinc-500">Loading vault…</p>;
  if (error || services.length === 0) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs leading-relaxed text-red-200"><p className="font-semibold">Vault is not ready</p><p className="mt-1 break-words">{error || 'No response from the server.'}</p><p className="mt-2 text-red-300/80">Check: (1) supabase/schema.sql was run in the Supabase SQL Editor, (2) VAULT_ENCRYPTION_KEY is set in Vercel, (3) the app was redeployed after adding env vars.</p></div>;
  return <div className="space-y-3">{services.map((s) => <Card key={s.service} s={s} onChange={onChange} />)}</div>;
}
