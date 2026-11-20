'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Cpu, Eye, EyeOff, Gauge, Mic2, Plug, Film, X } from 'lucide-react';
import { getPod, setPod, podCall, type PodStatus } from '@/lib/client/pod';
import { ensureGpu, omniStatus, clearGpu, type OmniStatus } from '@/lib/client/gpu';
import { api, getEngineEndpoint, setEngineEndpoint, type EngineKind, type ConnectResult, type HardwareInfo } from '@/lib/client/api';

interface Labels { commandCenter: string; close: string; done: string; performance: string; vram: string; storage: string; activeTasks: string }

const copy = {
  en: {
    voice: 'Voice Engine', voiceHelp: 'One key for every language (e.g. Kiri TTS). Saved on this device.', voicePh: 'Voice API key', saved: 'Saved',
    video: 'Video Engine', videoHelp: 'Any GPU worker: Google Colab, RunPod, or your own server. RunPod: https://api.runpod.ai/v2/<endpoint id>',
    urlPh: 'API URL (https://…)', keyPh: 'API key (optional for Colab)', connect: 'Connect', connecting: 'Connecting…', connected: 'Connected',
    notConnected: 'Not connected', gpu: 'GPU', model: 'AI model', workers: 'Workers', used: 'used', refreshed: 'Updated',
    image: 'Image Engine', imageHelp: 'GPU worker that makes images from your Signature Image (Colab or your own server). It can be the same URL as the Video Engine.',
    needUrl: 'Enter the API URL first.', live: 'Live hardware from your worker',
  },
  kh: {
    voice: 'Voice Engine', voiceHelp: 'Key តែមួយសម្រាប់គ្រប់ភាសា (ឧ. Kiri TTS)។ រក្សាទុកក្នុងឧបករណ៍នេះ។', voicePh: 'Voice API key', saved: 'បានរក្សាទុក',
    video: 'Video Engine', videoHelp: 'ម៉ាស៊ីន GPU ណាក៏បាន៖ Google Colab, RunPod ឬ server ផ្ទាល់ខ្លួន។ RunPod៖ https://api.runpod.ai/v2/<endpoint id>',
    urlPh: 'API URL (https://…)', keyPh: 'API key (Colab អាចទទេ)', connect: 'Connect', connecting: 'កំពុងភ្ជាប់…', connected: 'ភ្ជាប់បាន',
    notConnected: 'មិនទាន់ភ្ជាប់', gpu: 'GPU', model: 'AI model', workers: 'Workers', used: 'កំពុងប្រើ', refreshed: 'ធ្វើបច្ចុប្បន្នភាព',
    image: 'Image Engine', imageHelp: 'ម៉ាស៊ីន GPU ដែលបង្កើតរូបពី Signature Image (Colab ឬ server ផ្ទាល់ខ្លួន)។ អាចប្រើ URL ដូច Video Engine។',
    needUrl: 'សូមដាក់ API URL សិន។', live: 'Hardware ផ្ទាល់ពីម៉ាស៊ីនរបស់អ្នក',
  },
} as const;

type Status = { kind: 'idle' | 'testing' | 'ok' | 'bad'; text: string };
const pct = (used?: number, total?: number) => (used !== undefined && total ? Math.max(2, Math.min(100, Math.round((used / total) * 100))) : 0);
const gbText = (v?: number) => (v === undefined ? '—' : `${v % 1 === 0 ? v : v.toFixed(1)} GB`);

function SecretInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const [show, setShow] = useState(false);
  return <div className="access-row">
    <input className="studio-input" type={show ? 'text' : 'password'} aria-label={label} placeholder={placeholder} value={value} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    <button type="button" className="icon-button access-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide' : 'Show'}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
  </div>;
}

function EnginePanel({ kind, open, t, c }: { kind: EngineKind; open: boolean; t: Labels; c: (typeof copy)['en'] | (typeof copy)['kh'] }) {
  const Icon = Film;
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [workers, setWorkers] = useState<ConnectResult['workers']>();
  const [tasks, setTasks] = useState(0);
  const [updated, setUpdated] = useState('');
  const connectedRef = useRef(false);
  
  useEffect(() => {
    if (!open) return;
    const ep = getEngineEndpoint(kind);
    setUrl(ep.url); setKey(ep.key);
  }, [open, kind]);

  const countTasks = useCallback(async () => {
    if (kind !== 'video') return;
    try {
      const { jobs } = await api.listJobs();
      setTasks(jobs.filter((j) => j.status === 'queued' || j.status === 'running').reduce((n, j) => n + Math.max(0, j.progress.total - j.progress.done - j.progress.failed), 0));
    } catch { /* ignore: counter just stays */ }
  }, []);

  const run = useCallback(async (mode: 'connect' | 'refresh', ep: { url: string; key: string }) => {
    if (mode === 'connect') setStatus({ kind: 'testing', text: c.connecting });
    try {
      const r = await api.connect(ep, mode);
      if (!r.ok) { connectedRef.current = false; setStatus({ kind: 'bad', text: r.error ?? 'Could not connect' }); return; }
      connectedRef.current = true;
      if (r.hardware) setHw(r.hardware);
      setWorkers(r.workers);
      setUpdated(new Date().toLocaleTimeString());
      if (mode === 'connect') setStatus({ kind: 'ok', text: `${c.connected} · ${r.kind === 'runpod' ? 'RunPod' : 'HTTP worker'}${r.note ? ` · ${r.note}` : ''}` });
      else setStatus((s) => (s.kind === 'ok' || s.kind === 'idle' ? { kind: 'ok', text: s.text || c.connected } : s));
    } catch (error) {
      connectedRef.current = false;
      setStatus({ kind: 'bad', text: error instanceof Error ? error.message : 'Could not connect' });
    }
  }, [c.connected, c.connecting]);

  // While the panel is open: refresh once, then every 5 s (RunPod refresh only reads /health, which is free).
  useEffect(() => {
    if (!open) return;
    void countTasks();
    const ep = getEngineEndpoint(kind);
    if (ep.url) void run('refresh', ep);
    const id = window.setInterval(() => {
      void countTasks();
      const cur = getEngineEndpoint(kind);
      if (cur.url && connectedRef.current) void run('refresh', cur);
    }, 5000);
    return () => window.clearInterval(id);
  }, [open, run, countTasks, kind]);

  if (!open) return null;


  if (!open) return null;
  const connect = () => {
    if (!url.trim()) { setStatus({ kind: 'bad', text: c.needUrl }); return; }
    const ep = { url: url.trim(), key: key.trim() };
    setEngineEndpoint(kind, ep);
    void run('connect', ep);
  };
  const vramPct = pct(hw?.vramUsedGb, hw?.vramTotalGb);
  const diskPct = pct(hw?.diskUsedGb, hw?.diskTotalGb);

  return <>
      <section className="cc-block cc-video">
        <div className="cc-title"><Icon size={15} /><strong>{c.video}</strong>
          <span className={`cc-dot ${status.kind === 'ok' ? 'on' : status.kind === 'testing' ? 'wait' : ''}`} />
        </div>
        <input className="studio-input" type="url" inputMode="url" aria-label="API URL" placeholder={c.urlPh} value={url} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => { setUrl(e.target.value); connectedRef.current = false; setStatus({ kind: 'idle', text: '' }); }} />
        <SecretInput value={key} onChange={(v) => { setKey(v); connectedRef.current = false; }} placeholder={c.keyPh} label="API key" />
        <p className="access-help">{kind === 'image' ? c.imageHelp : kind === 'music' ? 'RunPod GPU worker (worker/music) that composes the song, swaps in YOUR Signature Voice and uploads the .mp3 to Document. Use the Pod proxy URL (https://<podId>-8000.proxy.runpod.net) or leave empty to use the saved Pod ID.' : c.videoHelp}</p>
        <button type="button" className="access-test" onClick={connect} disabled={status.kind === 'testing'}><Plug size={14} /> {status.kind === 'testing' ? c.connecting : c.connect}</button>
        {status.kind !== 'idle' && <div className={`access-status ${status.kind}`}>{status.text}</div>}

        <div className="performance-panel cc-monitor">
          <div className="performance-heading"><h3>{t.performance}</h3><Gauge size={19} /></div>
          <small className="cc-live">{status.kind === 'ok' ? `${c.live}${updated ? ` · ${c.refreshed} ${updated}` : ''}` : c.notConnected}</small>
          <div className="gpu-monitor-grid">
            <article><span>{hw?.gpu ?? c.gpu}</span><strong>{gbText(hw?.vramTotalGb)}</strong><small>{t.vram}{hw?.vramUsedGb !== undefined ? ` · ${gbText(hw.vramUsedGb)} ${c.used}` : ''}</small><div className="usage-bar"><i style={{ width: `${vramPct}%` }} /></div></article>
            <article><span>{t.storage}</span><strong>{gbText(hw?.diskTotalGb)}</strong><small>{hw?.diskUsedGb !== undefined ? `${gbText(hw.diskUsedGb)} ${c.used}` : t.storage}</small><div className="usage-bar"><i style={{ width: `${diskPct}%` }} /></div></article>
            <article><span>{c.model}</span><strong className="cc-model">{hw?.model ?? '—'}</strong>{workers && <small>{c.workers}: {workers.ready} ready · {workers.running} running</small>}</article>
            <article><span>{t.activeTasks}</span><strong>{String(kind === 'video' ? tasks : hw?.activeTasks ?? 0).padStart(2, '0')}</strong><div className="task-pips">{[0, 1, 2].map((i) => <i key={i} style={{ opacity: (kind === 'video' ? tasks : hw?.activeTasks ?? 0) > i ? 1 : 0.25 }} />)}</div></article>
          </div>
        </div>
      </section>
  </>;
}

const badge = (kh: boolean, s: OmniStatus | null, podOff: boolean) => {
  if (!s) return podOff ? '○ Not connected' : '○ Not connected';
  if (s.state === 'image') return kh ? '● កំពុងផលិតរូបភាព (Image Engine)' : '● Generating images (Image Engine)';
  if (s.state === 'music') return kh ? '● កំពុងផលិតបទចម្រៀង (Music Engine)' : '● Producing the song (Music Engine)';
  if (s.state === 'render') return kh ? '● កំពុង Render វីដេអូ (Timeline Render)' : '● Rendering video (Timeline Render)';
  return kh ? '○ រួចរាល់ / Standby' : '○ Ready / Standby';
};

/** ONE connection + ONE monitor for the whole GPU: Image, Music and Timeline Render all run on this single RunPod Omni-Worker. */
function AtomGpuPanel({ language, t }: { language: 'en' | 'kh'; t: Labels }) {
  const kh = language === 'kh';
  const [podId, setPodId] = useState('');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [auto, setAuto] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState<OmniStatus | null>(null);
  const [pod, setPodSt] = useState<PodStatus | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const p = getPod(); setPodId(p.podId); setAuto(p.auto);
    api.vault().then((v) => { const g = v.services.find((x) => x.service === 'gpu'); if (g) { setHasKey(g.hasKey); setSaved(g.hasKey && !!g.endpoint); setUrl(g.endpoint ?? ''); } }).catch(() => undefined);
  }, []);
  const target = () => (url.trim() || (podId.trim() ? `https://${podId.trim()}-8000.proxy.runpod.net` : ''));

  const poll = useCallback(async () => {
    const s = await omniStatus(); setSt(s);
    const p = getPod(); if (p.podId) setPodSt(await podCall('status', p.podId));
  }, []);
  useEffect(() => { void poll(); const id = window.setInterval(() => void poll(), 5000); return () => window.clearInterval(id); }, [poll]);

  const connect = async () => {
    const ep = target();
    if (!ep) { setMsg({ ok: false, text: kh ? 'សូមដាក់ Pod ID ឬ API URL សិន។' : 'Enter the Pod ID or API URL first.' }); return; }
    if (!key.trim() && !hasKey) { setMsg({ ok: false, text: kh ? 'សូមដាក់ API Key (ដូច ATOM_KEY លើ Pod)។' : 'Enter the API key (same as ATOM_KEY on the Pod).' }); return; }
    setBusy(true); setMsg(null);
    try {
      setPod({ podId: podId.trim(), auto });
      const r = await api.saveVault('gpu', key.trim(), ep);
      setKey(''); setHasKey(true); setSaved(true); setUrl(ep);
      clearGpu(); const g = await ensureGpu(true);
      const s = await omniStatus(); setSt(s);
      setMsg(g && s ? { ok: true, text: `${kh ? 'ភ្ជាប់បាន' : 'Connected'} · ${s.gpu}` } : { ok: false, text: r.message || (kh ? 'រក្សាទុកហើយ ប៉ុន្តែ Pod មិនទាន់ឆ្លើយ (ប្រហែលបិទ ឬកំពុងចាប់ផ្តើម)។ ការងារបន្ទាប់នឹងបើក Pod ស្វ័យប្រវត្តិ។' : 'Saved, but the Pod does not answer yet (off or starting). The next job wakes it automatically.') });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed' }); }
    setBusy(false);
  };
  const power = async (a: 'start' | 'stop') => { const id = podId.trim(); if (!id) return; setBusy(true); const r = await podCall(a, id); setPodSt(r); setBusy(false); };

  const vramPct = pct(st?.vram_used_gb ?? undefined, st?.vram_total_gb ?? undefined);
  const diskPct = pct(st?.disk_used_gb, st?.disk_total_gb);
  const gpuPct = Math.round(st?.gpu_util ?? pod?.gpuPct ?? 0);
  const active = st && st.state !== 'idle';
  const detail = !st || !active ? '' : st.state === 'image' ? `${kh ? 'Scene' : 'Scene'} ${Math.min(st.total ?? 0, (st.step ?? 0) + 1)}/${st.total ?? '?'}` : st.state === 'music' ? `${st.step ?? '?'}/7` : `${Math.round(st.percent ?? 0)}%${st.title ? ` · ${st.title}` : ''}`;
  const off = !st && pod?.ok && pod.state !== 'RUNNING';
  return <section className="cc-block cc-video">
    <div className="cc-title"><Cpu size={15} /><strong>Atom GPU Engine</strong><span className={`cc-dot ${st ? 'on' : busy ? 'wait' : ''}`} /></div>
    <input className="studio-input" aria-label="Pod ID" placeholder={kh ? 'Pod ID (ឧ. abc123xyz)' : 'Pod ID (e.g. abc123xyz)'} value={podId} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => { setPodId(e.target.value); setUrl(''); }} />
    <input className="studio-input" type="url" inputMode="url" aria-label="API URL" placeholder={kh ? 'ឬ API URL (https://…-8000.proxy.runpod.net)' : 'or API URL (https://…-8000.proxy.runpod.net)'} value={url} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
    <SecretInput value={key} onChange={setKey} placeholder={hasKey ? (kh ? '•••• រក្សាទុកក្នុង Vault (វាយថ្មីដើម្បីប្តូរ)' : '•••• stored in the Vault (type a new one to replace)') : 'API Key (ATOM_KEY)'} label="API key" />
    <p className="access-help">{kh ? 'GPU តែមួយ (RunPod Omni-Worker) សម្រាប់ Image Engine, Music Engine និង Timeline Render។ API Key ត្រូវបានអ៊ីនគ្រីប AES-256 ក្នុង Vault ហើយមិនត្រូវបានបង្ហាញម្តងទៀត ឬរក្សាក្នុងកម្មវិធីទេ។' : 'One GPU (RunPod Omni-Worker) for Image Engine, Music Engine and Timeline Render. The key is AES-256 encrypted in the Vault and never shown again or stored in the app.'}</p>
    <label className="access-help" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setPod({ podId: podId.trim(), auto: e.target.checked }); }} />
      {kh ? 'Auto-Start / Auto-Stop (បើកជាលំនាំដើម): បើក Pod ពេលចាប់ផ្តើមការងារ ហើយបិទអូតូពេលចប់ (កុំពុងចាក់សោទូរស័ព្ទក៏បាន)' : 'Auto-Start / Auto-Stop (ON by default): wakes the Pod for a job and stops it when the queue is empty, even if the phone is locked'}
    </label>
    <button type="button" className="access-test" onClick={() => void connect()} disabled={busy}><Plug size={14} /> {busy ? (kh ? 'កំពុងភ្ជាប់…' : 'Connecting…') : saved ? (kh ? 'រក្សាទុក & Connect' : 'Save & Connect') : 'Connect'}</button>
    {podId.trim() && <div className="flex gap-2">
      <button type="button" className="access-test" disabled={busy} onClick={() => void power('start')}>{kh ? 'បើក Pod' : 'Start Pod'}</button>
      <button type="button" className="access-test" disabled={busy} onClick={() => void power('stop')}>{kh ? 'បិទ Pod' : 'Stop Pod'}</button>
    </div>}
    {msg && <div className={`access-status ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}

    <div className="performance-panel cc-monitor">
      <div className="performance-heading"><h3>{t.performance}</h3><Gauge size={19} /></div>
      <small className="cc-live"><strong>{off ? '○ Not connected (Pod off)' : badge(kh, st, false)}</strong>{detail ? ` · ${detail}` : ''}</small>
      <div className="gpu-monitor-grid">
        <article><span>{st?.gpu ?? pod?.gpu ?? 'GPU'}</span><strong>{st || pod?.ok ? `${gpuPct}%` : '—'}</strong><small>GPU</small><div className="usage-bar"><i style={{ width: `${gpuPct}%` }} /></div></article>
        <article><span>VRAM</span><strong>{gbText(st?.vram_total_gb ?? undefined)}</strong><small>{st?.vram_used_gb != null ? `${gbText(st.vram_used_gb)} ${kh ? 'កំពុងប្រើ' : 'used'}` : t.vram}</small><div className="usage-bar"><i style={{ width: `${vramPct}%` }} /></div></article>
        <article><span>{t.storage}</span><strong>{gbText(st?.disk_total_gb)}</strong><small>{st ? `${gbText(st.disk_used_gb)} ${kh ? 'កំពុងប្រើ' : 'used'}` : t.storage}</small><div className="usage-bar"><i style={{ width: `${diskPct}%` }} /></div></article>
        <article><span>{kh ? 'AI model សកម្ម' : 'Active AI model'}</span><strong className="cc-model">{active ? st?.model ?? '—' : '—'}</strong></article>
        <article><span>{t.activeTasks}</span><strong>{String(st?.active_tasks ?? 0).padStart(2, '0')}</strong><div className="task-pips">{[0, 1, 2].map((i) => <i key={i} style={{ opacity: (st?.active_tasks ?? 0) > i ? 1 : 0.2 }} />)}</div></article>
      </div>
    </div>
  </section>;
}

export function CommandCenter({ open, onClose, t, language, show }: { open: boolean; onClose: () => void; t: Labels; language: 'en' | 'kh'; show: { voice: boolean; video: boolean; image: boolean; music?: boolean } }) {
  const c = copy[language];
  if (!open) return null;
  return <div className="modal-backdrop" onMouseDown={onClose}><aside className="command-drawer" onMouseDown={(e) => e.stopPropagation()}>
    <div className="drawer-header"><h2>{t.commandCenter}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={t.close}><X size={20} /></button></div>
    <div className="drawer-content">
      {show.voice && <section className="cc-block"><div className="cc-title"><Mic2 size={15} /><strong>{c.voice}</strong></div><p className="access-help">{language === 'kh' ? 'Voice key (Premium Voice) ត្រូវរក្សាទុកក្នុង Settings → API Key Vault (អ៊ីនគ្រីប)។ បើគ្មាន key ប្រើ gTTS ឥតគិតថ្លៃ។' : 'Voice keys live in Settings → API Key Vault (encrypted). With no key the free gTTS voice is used.'}</p></section>}
      <AtomGpuPanel language={language} t={t} />
      {show.video && <EnginePanel kind="video" open={open} t={t} c={c} />}
    </div>
    <button type="button" className="drawer-save" onClick={onClose}><Check size={16} /> {t.done}</button>
  </aside></div>;
}
