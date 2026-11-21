'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Cpu, Eye, EyeOff, Gauge, Plug, Film, X } from 'lucide-react';
import { getPod, podCall, type PodStatus } from '@/lib/client/pod';
import { ensureGpu, omniStatus, type OmniStatus } from '@/lib/client/gpu';
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

const KIND: Record<string, { en: string; kh: string }> = {
  image: { en: 'Image Engine', kh: 'Image Engine' }, music: { en: 'Music Engine', kh: 'Music Engine' },
  render: { en: 'Timeline Render', kh: 'Timeline Render' }, voice: { en: 'Voice Clone', kh: 'Voice Clone' },
};
const badge = (kh: boolean, s: OmniStatus | null) => {
  if (!s) return kh ? '○ Pod Offline' : '○ Pod Offline';
  if (s.state === 'image') return kh ? '● កំពុងផលិតរូបភាព (Image Engine)' : '● Generating images (Image Engine)';
  if (s.state === 'music') return kh ? '● កំពុងផលិតបទចម្រៀង (Music Engine)' : '● Producing the song (Music Engine)';
  if (s.state === 'voice') return kh ? '● កំពុងផលិតសំឡេង (Voice Clone)' : '● Cloning voice (Voice Clone)';
  if (s.state === 'render') return kh ? '● កំពុង Render វីដេអូ (Timeline Render)' : '● Rendering video (Timeline Render)';
  return kh ? '● Pod Online · រង់ចាំការងារ' : '● Pod Online · Standby';
};
const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

/** Performance Monitor: LIVE TELEMETRY ONLY. All connection fields live in Settings → API Key Vault → Atom GPU Engine. */
function AtomMonitorPanel({ language, t }: { language: 'en' | 'kh'; t: Labels }) {
  const kh = language === 'kh';
  const [st, setSt] = useState<OmniStatus | null>(null);
  const [pod, setPodSt] = useState<PodStatus | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [idle, setIdle] = useState<number | null>(null);

  const poll = useCallback(async () => {
    const s = await omniStatus(); setSt(s); setIdle(s?.idle_in_sec ?? null);
    const p = getPod();
    if (!s && p.podId) setPodSt(await podCall('status', p.podId)); else if (s) setPodSt(null);
    if (!s) { const g = await ensureGpu(); setConfigured(!!g); } else setConfigured(true);
  }, []);
  useEffect(() => { void poll(); const id = window.setInterval(() => void poll(), 5000); return () => window.clearInterval(id); }, [poll]);
  useEffect(() => { const id = window.setInterval(() => setIdle((v) => (v === null ? v : Math.max(0, v - 1))), 1000); return () => window.clearInterval(id); }, []);

  const power = async (a: 'start' | 'stop') => { const id = getPod().podId; if (!id) return; setBusy(true); setPodSt(await podCall(a, id)); setBusy(false); };
  const vramPct = pct(st?.vram_used_gb ?? undefined, st?.vram_total_gb ?? undefined);
  const diskPct = pct(st?.disk_used_gb, st?.disk_total_gb);
  const gpuPct = Math.round(st?.gpu_util ?? 0);
  const active = !!st && st.state !== 'idle';
  const online = !!st;
  const detail = !active || !st ? '' : st.state === 'image' ? `Scene ${Math.min(st.total ?? 0, (st.step ?? 0) + 1)}/${st.total ?? '?'}` : st.state === 'music' ? `${st.step ?? '?'}/7` : `${Math.round(st.percent ?? 0)}%${st.title ? ` · ${st.title}` : ''}`;
  const countdown = !online ? '—' : st?.auto_stop === false ? (kh ? 'បិទ (OFF)' : 'OFF') : idle === null ? (kh ? 'ផ្អាក · កំពុងធ្វើការ' : 'Paused · job running') : mmss(idle);
  const jobs = st?.jobs ?? [];
  return <section className="cc-block cc-video">
    <div className="cc-title"><Cpu size={15} /><strong>Performance Monitor</strong><span className={`cc-dot ${online ? 'on' : busy ? 'wait' : ''}`} /></div>
    {configured === false && !online && <p className="access-help">{kh ? 'មិនទាន់ភ្ជាប់ — ដំឡើងក្នុង Settings → API Key Vault → Atom GPU Engine។' : 'Not connected — set it up in Settings → API Key Vault → Atom GPU Engine.'}</p>}
    <div className="performance-panel cc-monitor">
      <div className="performance-heading"><h3>{t.performance}</h3><Gauge size={19} /></div>
      <small className="cc-live"><strong>{badge(kh, st)}</strong>{detail ? ` · ${detail}` : ''}{!online && pod?.ok && pod.state ? ` · RunPod: ${pod.state}` : ''}</small>
      <div className="gpu-monitor-grid">
        <article><span>{st?.gpu ?? pod?.gpu ?? 'GPU'}</span><strong>{online ? `${gpuPct}%` : '—'}</strong><small>GPU</small><div className="usage-bar"><i style={{ width: `${gpuPct}%` }} /></div></article>
        <article><span>VRAM</span><strong>{gbText(st?.vram_total_gb ?? undefined)}</strong><small>{st?.vram_used_gb != null ? `${gbText(st.vram_used_gb)} ${kh ? 'កំពុងប្រើ' : 'used'}` : t.vram}</small><div className="usage-bar"><i style={{ width: `${vramPct}%` }} /></div></article>
        <article><span>/workspace {t.storage}</span><strong>{gbText(st?.disk_total_gb)}</strong><small>{st ? `${gbText(st.disk_used_gb)} ${kh ? 'កំពុងប្រើ' : 'used'}` : t.storage}</small><div className="usage-bar"><i style={{ width: `${diskPct}%` }} /></div></article>
        <article><span>{kh ? 'Pod' : 'Pod'}</span><strong>{online ? 'Online' : 'Offline'}</strong><small>{online ? (kh ? 'កំពុងដំណើរការ' : 'Running') : (kh ? 'បិទ ឬមិនទាន់ភ្ជាប់' : 'Off or not connected')}</small></article>
        <article><span>Auto-Stop</span><strong>{countdown}</strong><small>{kh ? 'រាប់ថយក្រោយពេលទំនេរ' : 'Idle countdown'}</small></article>
        <article><span>{kh ? 'AI model សកម្ម' : 'Active AI model'}</span><strong className="cc-model">{active ? st?.model ?? '—' : '—'}</strong></article>
        <article><span>{t.activeTasks}</span><strong>{String(st?.active_tasks ?? 0).padStart(2, '0')}</strong><div className="task-pips">{[0, 1, 2].map((i) => <i key={i} style={{ opacity: (st?.active_tasks ?? 0) > i ? 1 : 0.2 }} />)}</div></article>
      </div>
      <div style={{ marginTop: 10 }}>
        <small className="cc-live"><strong>{kh ? 'ជួរការងារ GPU' : 'GPU job queue'}</strong></small>
        {jobs.length === 0 ? <p className="access-help">{kh ? 'គ្មានការងារ' : 'No jobs yet'}</p> : <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'grid', gap: 6 }}>
          {jobs.map((j) => <li key={`${j.kind}-${j.id}`} className="access-help" style={{ display: 'flex', gap: 8, justifyContent: 'space-between', margin: 0 }}>
            <span>{j.status === 'RUNNING' ? '▶' : j.status === 'QUEUED' ? '⏳' : j.status === 'COMPLETED' ? '✓' : '✕'} {KIND[j.kind]?.[language] ?? j.kind}{j.stage ? ` · ${j.stage}` : ''}</span>
            <span>{j.status === 'RUNNING' ? `${Math.round(j.percent ?? 0)}%` : j.status}</span>
          </li>)}
        </ul>}
      </div>
    </div>
    {getPod().podId && <div className="flex gap-2">
      <button type="button" className="access-test" disabled={busy || online} onClick={() => void power('start')}>{kh ? 'បើក Pod' : 'Start Pod'}</button>
      <button type="button" className="access-test" disabled={busy || active} onClick={() => void power('stop')}>{kh ? 'បិទ Pod' : 'Stop Pod'}</button>
    </div>}
  </section>;
}

export function CommandCenter({ open, onClose, t, language, show }: { open: boolean; onClose: () => void; t: Labels; language: 'en' | 'kh'; show: { voice: boolean; video: boolean; image: boolean; music?: boolean } }) {
  const c = copy[language];
  if (!open) return null;
  return <div className="modal-backdrop" onMouseDown={onClose}><aside className="command-drawer" onMouseDown={(e) => e.stopPropagation()}>
    <div className="drawer-header"><h2>{t.commandCenter}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={t.close}><X size={20} /></button></div>
    <div className="drawer-content">
      <AtomMonitorPanel language={language} t={t} />
      {show.video && <EnginePanel kind="video" open={open} t={t} c={c} />}
    </div>
    <button type="button" className="drawer-save" onClick={onClose}><Check size={16} /> {t.done}</button>
  </aside></div>;
}
