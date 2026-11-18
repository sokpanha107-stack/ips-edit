'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff, Gauge, Image as ImageIcon, Mic2, Plug, Film, X } from 'lucide-react';
import { getPod, setPod, podCall, type PodStatus } from '@/lib/client/pod';
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
  const Icon = kind === 'image' ? ImageIcon : Film;
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
        <div className="cc-title"><Icon size={15} /><strong>{kind === 'image' ? c.image : c.video}</strong>
          <span className={`cc-dot ${status.kind === 'ok' ? 'on' : status.kind === 'testing' ? 'wait' : ''}`} />
        </div>
        <input className="studio-input" type="url" inputMode="url" aria-label="API URL" placeholder={c.urlPh} value={url} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => { setUrl(e.target.value); connectedRef.current = false; setStatus({ kind: 'idle', text: '' }); }} />
        <SecretInput value={key} onChange={(v) => { setKey(v); connectedRef.current = false; }} placeholder={c.keyPh} label="API key" />
        <p className="access-help">{kind === 'image' ? c.imageHelp : c.videoHelp}</p>
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

function PodPanel({ language }: { language: 'en' | 'kh' }) {
  const kh = language === 'kh';
  const [podId, setPodId] = useState('');
  const [auto, setAuto] = useState(false);
  const [st, setSt] = useState<PodStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const p = getPod(); setPodId(p.podId); setAuto(p.auto); }, []);
  const save = (id: string, a: boolean) => setPod({ podId: id.trim(), auto: a });
  const refresh = useCallback(async (id: string) => { if (id) setSt(await podCall('status', id)); }, []);
  useEffect(() => {
    if (!podId.trim()) return;
    void refresh(podId.trim());
    const t = window.setInterval(() => void refresh(podId.trim()), 8000);
    return () => window.clearInterval(t);
  }, [podId, refresh]);
  const power = async (a: 'start' | 'stop') => { setBusy(true); const r = await podCall(a, podId.trim()); if (!r.ok) setSt(r); else await refresh(podId.trim()); setBusy(false); };
  const num = (v?: number | null) => (typeof v === 'number' ? `${Math.round(v)}%` : '—');
  return <section className="cc-block">
    <div className="cc-title"><Gauge size={15} /><strong>RunPod Pod</strong></div>
    <input className="studio-input" aria-label="Pod ID" placeholder={kh ? 'Pod ID (ស្រេចចិត្ត)' : 'Pod ID (optional)'} value={podId} autoComplete="off" autoCapitalize="off" spellCheck={false}
      onChange={(e) => { setPodId(e.target.value); save(e.target.value, auto); }} />
    <p className="access-help">{kh ? 'សម្រាប់ Pod ប៉ុណ្ណោះ (Serverless គ្រប់គ្រង Start/Stop ខ្លួនឯង ហើយមិនបង្ហាញ CPU/RAM/VRAM ទេ)។ ប្រើ API key ក្នុង Vault។' : 'For Pods only (Serverless starts/stops itself and reports no CPU/RAM/VRAM). Uses the API key from your Vault.'}</p>
    {podId.trim() && <>
      {st && !st.ok && <div className="access-status bad">{st.error}</div>}
      {st?.ok && <div className="gpu-monitor-grid">
        <article><span>{st.gpu ?? 'GPU'}</span><strong>{st.state}</strong><small>GPU {num(st.gpuPct)}</small></article>
        <article><span>CPU</span><strong>{num(st.cpuPct)}</strong><div className="usage-bar"><i style={{ width: `${st.cpuPct ?? 0}%` }} /></div></article>
        <article><span>VRAM</span><strong>{num(st.vramPct)}</strong><div className="usage-bar"><i style={{ width: `${st.vramPct ?? 0}%` }} /></div></article>
        <article><span>RAM</span><strong>{num(st.ramPct)}</strong><small>{st.ramGb ? `${st.ramGb} GB` : ''}</small><div className="usage-bar"><i style={{ width: `${st.ramPct ?? 0}%` }} /></div></article>
      </div>}
      <div className="flex gap-2">
        <button type="button" className="access-test" disabled={busy} onClick={() => void power('start')}>{kh ? 'បើក Pod' : 'Start Pod'}</button>
        <button type="button" className="access-test" disabled={busy} onClick={() => void power('stop')}>{kh ? 'បិទ Pod' : 'Stop Pod'}</button>
      </div>
      <label className="access-help" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); save(podId, e.target.checked); }} />
        {kh ? 'បើកស្វ័យប្រវត្តិពេលចាប់ផ្តើមការងារ ហើយបិទពេលចប់' : 'Auto-start when a job begins, auto-stop when it finishes'}
      </label>
    </>}
  </section>;
}

export function CommandCenter({ open, onClose, t, language, show }: { open: boolean; onClose: () => void; t: Labels; language: 'en' | 'kh'; show: { voice: boolean; video: boolean; image: boolean } }) {
  const c = copy[language];
  if (!open) return null;
  const none = !show.voice && !show.video && !show.image;
  return <div className="modal-backdrop" onMouseDown={onClose}><aside className="command-drawer" onMouseDown={(e) => e.stopPropagation()}>
    <div className="drawer-header"><h2>{t.commandCenter}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={t.close}><X size={20} /></button></div>
    <div className="drawer-content">
      {none && <p className="access-help">Every engine is switched off in Settings → Menu &amp; features.</p>}
      {show.voice && <section className="cc-block"><div className="cc-title"><Mic2 size={15} /><strong>{c.voice}</strong></div><p className="access-help">Voice keys live in Settings → API Key Vault (encrypted, never shown again). With no Premium Voice key, the free gTTS voice is used.</p></section>}
      {show.video && <EnginePanel kind="video" open={open} t={t} c={c} />}
      {show.image && <EnginePanel kind="image" open={open} t={t} c={c} />}
      {(show.video || show.image) && <PodPanel language={language} />}
    </div>
    <button type="button" className="drawer-save" onClick={onClose}><Check size={16} /> {t.done}</button>
  </aside></div>;
}
