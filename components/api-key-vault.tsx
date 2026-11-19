'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, PlugZap, Trash2 } from 'lucide-react';
import { api, type VaultService } from '@/lib/client/api';

const INFO = {
  gemini: { title: 'Gemini AI Assistant', help: 'Powers the in-app AI Assistant. Create a key in Google AI Studio and paste it here. It is stored encrypted and only used by the server.', endpointLabel: '', endpointPh: '', required: 'Required for the AI Assistant.', noEndpoint: true },
  runpod: { title: 'RunPod GPU', help: 'Runs Video Engine jobs on your own GPU. Paste your RunPod API key and the Endpoint ID (or its https URL).', endpointLabel: 'Endpoint ID or URL', endpointPh: 'e.g. abc123xyz or https://api.runpod.ai/v2/abc123xyz', required: 'Needed for: Video Engine' },
  video: { title: 'Video Engine', help: 'Optional. A separate GPU/server just for Video Engine (same contract as RunPod). If empty, the RunPod entry above is used.', endpointLabel: 'Video server URL or Endpoint ID', endpointPh: 'https://… or RunPod endpoint ID', required: 'Optional: dedicated video server' },
  voice_api: { title: 'Premium Voice', help: 'Optional. Your own voice server (e.g. a Khmer voice-clone worker). Without it, the free gTTS voice is used automatically.', endpointLabel: 'Voice server URL', endpointPh: 'https://your-voice-server.example.com', required: 'Optional: premium voice quality' },
} as const;

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-6 w-11 flex-none rounded-full border border-[var(--line)] transition-colors ${on ? 'bg-[var(--amber)]' : 'bg-[color-mix(in_srgb,var(--ink)_14%,transparent)]'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} /></button>;
}

function Card({ s, onChange, enabled, onToggle }: { s: VaultService; onChange: (v: VaultService[]) => void; enabled: boolean; onToggle: (v: boolean) => void }) {
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
  const pill = s.status === 'connected' ? { t: '🟢 Connected', c: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700' }
    : s.status === 'failed' ? { t: '🔴 Failed', c: 'border-red-500/40 bg-red-500/10 text-red-700' }
    : s.hasKey ? { t: '⚪ Not tested', c: 'border-[var(--line)] bg-[color-mix(in_srgb,var(--ink)_12%,transparent)] text-[var(--ink)]' } : { t: '⚪ Not set', c: 'border-[var(--line)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-[var(--ink-soft)]' };

  return <section className="border-b border-[var(--line)] py-4 text-[var(--ink)]">
    <div className="flex items-center gap-2">
      <KeyRound size={16} className="text-[var(--amber-deep)]" /><h4 className="text-sm font-semibold">{info.title}</h4>
      {enabled && <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${pill.c}`}>{pill.t}</span>}
      <span className={enabled ? '' : 'ml-auto'}><Switch on={enabled} onChange={onToggle} label={`${info.title} on/off`} /></span>
    </div>
    {enabled && <>
    <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">{info.help}</p>
    <p className="mt-1 text-[11px] text-[var(--amber-deep)]">{info.required}</p>

    <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-soft)]">API key</label>
    <div className="mt-1 flex gap-2">
      <input type={show ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false}
        placeholder={s.hasKey ? `Saved ${s.hint}. Leave empty to keep it` : 'Paste key'}
        className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-3 py-2.5 text-sm outline-none placeholder:text-[var(--ink-soft)] focus:border-amber-500/60" />
      <button type="button" onClick={() => setShow((v) => !v)} className="grid w-10 place-items-center rounded-lg border border-[var(--line)] text-[var(--ink-soft)] hover:text-[var(--ink)]" aria-label={show ? 'Hide key' : 'Show key'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div>

    {!('noEndpoint' in info) && <><label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-soft)]">{info.endpointLabel}</label>
    <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder={info.endpointPh}
      className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-3 py-2.5 text-sm outline-none placeholder:text-[var(--ink-soft)] focus:border-amber-500/60" /></>}

    <div className="mt-3 flex gap-2">
      <button type="button" onClick={save} disabled={busy || (!key && !s.hasKey)} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />} Save &amp; Test Connection
      </button>
      {s.hasKey && <button type="button" onClick={remove} disabled={busy} className="grid w-11 place-items-center rounded-lg border border-[var(--line)] text-[var(--ink-soft)] hover:border-red-500/50 hover:text-red-600" aria-label="Remove key"><Trash2 size={16} /></button>}
    </div>
    {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
    <p className="mt-2 text-[11px] text-[var(--ink-soft)]">Stored encrypted. The key is never sent back to this screen.</p>
    </>}
  </section>;
}

export function ApiKeyVault({ services, error, onChange }: { services: VaultService[] | null; error?: string; onChange: (v: VaultService[]) => void }) {
  if (!services) return <p className="text-xs text-[var(--ink-soft)]">Loading vault…</p>;
  if (error || services.length === 0) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs leading-relaxed text-red-700"><p className="font-semibold">Vault is not ready</p><p className="mt-1 break-words">{error || 'No response from the server.'}</p><p className="mt-2 text-red-700">Check: (1) supabase/schema.sql was run in the Supabase SQL Editor, (2) VAULT_ENCRYPTION_KEY is set in Vercel, (3) the app was redeployed after adding env vars.</p></div>;
  return <VaultList services={services} onChange={onChange} />;
}

const OFF_KEY = 'ips-vault-off';
function VaultList({ services, onChange }: { services: VaultService[]; onChange: (v: VaultService[]) => void }) {
  const [off, setOff] = useState<string[]>([]);
  useEffect(() => { try { setOff(JSON.parse(window.localStorage.getItem(OFF_KEY) || '[]')); } catch { /* storage unavailable */ } }, []);
  const toggle = (id: string, on: boolean) => setOff((cur) => {
    const next = on ? cur.filter((x) => x !== id) : [...cur.filter((x) => x !== id), id];
    try { window.localStorage.setItem(OFF_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  const sorted = [...services].sort((a, b) => Number(off.includes(a.service)) - Number(off.includes(b.service)));   // stable: switched-off cards sink to the bottom
  return <div>{sorted.map((s) => <Card key={s.service} s={s} onChange={onChange} enabled={!off.includes(s.service)} onToggle={(on) => toggle(s.service, on)} />)}</div>;
}
