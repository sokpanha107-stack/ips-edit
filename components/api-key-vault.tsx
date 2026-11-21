'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, PlugZap, Trash2 } from 'lucide-react';
import { api, type VaultService } from '@/lib/client/api';
import { getPod, setPod } from '@/lib/client/pod';
import { clearGpu, ensureGpu, omniStatus } from '@/lib/client/gpu';

const INFO = {
  gemini: { title: 'Gemini AI Assistant', help: 'Powers the in-app AI Assistant. Create a key in Google AI Studio and paste it here. It is stored encrypted and only used by the server.', endpointLabel: '', endpointPh: '', required: 'Required for the AI Assistant.', noEndpoint: true },
  runpod: { title: 'RunPod GPU', help: 'Runs Video Engine jobs on your own GPU. Paste your RunPod API key and the Endpoint ID (or its https URL).', endpointLabel: 'Endpoint ID or URL', endpointPh: 'e.g. abc123xyz or https://api.runpod.ai/v2/abc123xyz', required: 'Needed for: Video Engine' },
  video: { title: 'Video Engine', help: 'Optional. A separate GPU/server just for Video Engine (same contract as RunPod). Only used when the Video Engine toggle is ON (Settings → Features).', endpointLabel: 'Video server URL or Endpoint ID', endpointPh: 'https://… or RunPod endpoint ID', required: 'Optional: dedicated video server' },
  gpu: { title: 'Atom GPU Engine (RunPod Omni-Worker)', help: 'One GPU for Image, Music and Timeline Render. Key = the ATOM_KEY secret you set on the Pod. Endpoint = https://<podId>-8000.proxy.runpod.net. The browser never sees this key: it gets a short-lived token from the server.', endpointLabel: 'Pod URL', endpointPh: 'https://<podId>-8000.proxy.runpod.net', required: 'Needed for: Image · Music · Render' },
  telegram: { title: 'Telegram Alerts', help: 'Optional lock-screen alerts when a job finishes or fails. Key = your bot token (from @BotFather). Second field = your numeric Chat ID.', endpointLabel: 'Chat ID', endpointPh: 'e.g. 123456789', required: 'Optional: guaranteed iPhone alerts' },
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
      {!enabled && s.hasKey && s.status !== 'failed' && <span role="img" aria-label="Connected" title="Connected" className="ml-2 inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />}
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


/** Pod ID or full proxy URL -> { podId, url }. */
function parsePod(v: string): { podId: string; url: string } {
  const t = v.trim().replace(/\/+$/, '');
  if (!t) return { podId: '', url: '' };
  const m = t.match(/^https?:\/\/([a-z0-9]+)-\d+\.proxy\.runpod\.net/i);
  if (m) return { podId: m[1], url: t };
  if (/^https?:\/\//i.test(t)) return { podId: '', url: t };
  return { podId: t, url: `https://${t}-8000.proxy.runpod.net` };
}

/** The ONE GPU connection: RunPod API key + Pod ID/URL + ATOM_KEY. Performance Monitor and every engine read from here. */
function GpuCard({ runpod, gpu, onChange }: { runpod?: VaultService; gpu?: VaultService; onChange: (v: VaultService[]) => void }) {
  const [rpKey, setRpKey] = useState('');
  const [atomKey, setAtomKey] = useState('');
  const [pod, setPodTxt] = useState(gpu?.endpoint ?? '');
  const [auto, setAuto] = useState(true);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { const p = getPod(); setAuto(p.auto); if (!gpu?.endpoint && p.podId) setPodTxt(p.podId); }, [gpu?.endpoint]);
  const connected = !!gpu?.hasKey && !!gpu?.endpoint;
  const inp = 'w-full rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-3 py-2.5 text-sm outline-none placeholder:text-[var(--ink-soft)] focus:border-amber-500/60';
  const lab = 'mt-3 block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-soft)]';

  const save = async () => {
    const t = parsePod(pod);
    if (!t.url) { setMsg({ ok: false, text: 'Enter the Pod ID or the Pod proxy URL.' }); return; }
    if (!atomKey.trim() && !gpu?.hasKey) { setMsg({ ok: false, text: 'Enter ATOM_KEY (the secret you set on the Pod).' }); return; }
    setBusy(true); setMsg(null);
    try {
      setPod({ podId: t.podId, auto });
      let list: VaultService[] | undefined;
      if (rpKey.trim()) { const r = await api.saveVault('runpod', rpKey.trim(), runpod?.endpoint ?? ''); list = r.services; if (!r.ok) { onChange(r.services); setMsg({ ok: false, text: r.message }); setBusy(false); return; } }
      const g = await api.saveVault('gpu', atomKey.trim(), t.url);
      onChange(g.services); setRpKey(''); setAtomKey(''); setShow(false); setPodTxt(t.url);
      clearGpu(); const conn = await ensureGpu(true); const st = conn ? await omniStatus() : null;
      setMsg(st ? { ok: true, text: `Connected · ${st.gpu}` } : { ok: g.ok, text: g.ok ? 'Saved. ' : `${g.message} ` + 'The Pod may be off or starting. The next job wakes it automatically.' });
      void list;
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed' }); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    try { await api.deleteVault('gpu'); onChange((await api.deleteVault('runpod')).services); setPodTxt(''); setRpKey(''); setAtomKey(''); setMsg(null); setPod({ podId: '', auto }); clearGpu(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed' }); }
    setBusy(false);
  };
  const pill = connected && gpu?.status !== 'failed' ? { t: gpu?.status === 'connected' ? '🟢 Connected' : '⚪ Saved', c: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700' }
    : gpu?.status === 'failed' ? { t: '🔴 Failed', c: 'border-red-500/40 bg-red-500/10 text-red-700' } : { t: '⚪ Not set', c: 'border-[var(--line)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-[var(--ink-soft)]' };

  return <section className="border-b border-[var(--line)] py-4 text-[var(--ink)]">
    <div className="flex items-center gap-2"><KeyRound size={16} className="text-[var(--amber-deep)]" /><h4 className="text-sm font-semibold">Atom GPU Engine · RunPod RTX A6000</h4><span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${pill.c}`}>{pill.t}</span></div>
    <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">The single source of truth for the GPU. One Pod runs Image, Music, Voice Clone and Timeline Render. Performance Monitor only displays live status. Keys are stored encrypted; the browser only gets a short-lived token.</p>
    <p className="mt-1 text-[11px] text-[var(--amber-deep)]">Needed for: Image · Music · Voice Clone · Render</p>

    <label className={lab}>RunPod API key</label>
    <input type={show ? 'text' : 'password'} value={rpKey} onChange={(e) => setRpKey(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} className={`${inp} mt-1`} placeholder={runpod?.hasKey ? `Saved ${runpod.hint}. Leave empty to keep it` : 'Paste RunPod API key (starts/stops the Pod)'} />
    <label className={lab}>Pod ID or Proxy URL</label>
    <input value={pod} onChange={(e) => setPodTxt(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} className={`${inp} mt-1`} placeholder="abc123xyz  or  https://abc123xyz-8000.proxy.runpod.net" />
    <label className={lab}>ATOM_KEY</label>
    <div className="mt-1 flex gap-2">
      <input type={show ? 'text' : 'password'} value={atomKey} onChange={(e) => setAtomKey(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} className={`${inp} min-w-0 flex-1`} placeholder={gpu?.hasKey ? `Saved ${gpu.hint}. Leave empty to keep it` : 'The ATOM_KEY secret you set on the Pod'} />
      <button type="button" onClick={() => setShow((v) => !v)} className="grid w-10 place-items-center rounded-lg border border-[var(--line)] text-[var(--ink-soft)] hover:text-[var(--ink)]" aria-label={show ? 'Hide keys' : 'Show keys'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div>
    <label className="mt-3 flex items-start gap-2 text-xs text-[var(--ink-soft)]"><input type="checkbox" className="mt-0.5" checked={auto} onChange={(e) => { setAuto(e.target.checked); setPod({ podId: parsePod(pod).podId, auto: e.target.checked }); }} />Auto-Start / Auto-Stop (ON by default): wakes the Pod for a job and stops it when the queue is empty, even if the phone is locked.</label>

    <div className="mt-3 flex gap-2">
      <button type="button" onClick={() => void save()} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />} Save &amp; Test Connection</button>
      {(gpu?.hasKey || runpod?.hasKey) && <button type="button" onClick={() => void remove()} disabled={busy} className="grid w-11 place-items-center rounded-lg border border-[var(--line)] text-[var(--ink-soft)] hover:border-red-500/50 hover:text-red-600" aria-label="Remove GPU connection"><Trash2 size={16} /></button>}
    </div>
    {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
    <p className="mt-2 text-[11px] text-[var(--ink-soft)]">Stored encrypted. Keys are never sent back to this screen.</p>
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
  const rp = services.find((x) => x.service === 'runpod'); const gp = services.find((x) => x.service === 'gpu');
  return <div><GpuCard runpod={rp} gpu={gp} onChange={onChange} />{sorted.filter((s) => s.service !== 'runpod' && s.service !== 'gpu').map((s) => <Card key={s.service} s={s} onChange={onChange} enabled={!off.includes(s.service)} onToggle={(on) => toggle(s.service, on)} />)}</div>;
}
