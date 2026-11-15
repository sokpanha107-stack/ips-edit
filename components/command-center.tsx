'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff, Gauge, Mic2, Plug, Film, X } from 'lucide-react';
import { api, getVideoEndpoint, getVoiceKey, setVideoEndpoint, setVoiceKey, type ConnectResult, type HardwareInfo } from '@/lib/client/api';

interface Labels { commandCenter: string; close: string; done: string; performance: string; vram: string; storage: string; activeTasks: string }

const copy = {
  en: {
    voice: 'Voice Engine', voiceHelp: 'One key for every language (e.g. Kiri TTS). Saved on this device.', voicePh: 'Voice API key', saved: 'Saved',
    video: 'Video Engine', videoHelp: 'Any GPU worker: Google Colab, RunPod, or your own server. RunPod: https://api.runpod.ai/v2/<endpoint id>',
    urlPh: 'API URL (https://…)', keyPh: 'API key (optional for Colab)', connect: 'Connect', connecting: 'Connecting…', connected: 'Connected',
    notConnected: 'Not connected', gpu: 'GPU', model: 'AI model', workers: 'Workers', used: 'used', refreshed: 'Updated',
    needUrl: 'Enter the API URL first.', live: 'Live hardware from your worker',
  },
  kh: {
    voice: 'Voice Engine', voiceHelp: 'Key តែមួយសម្រាប់គ្រប់ភាសា (ឧ. Kiri TTS)។ រក្សាទុកក្នុងឧបករណ៍នេះ។', voicePh: 'Voice API key', saved: 'បានរក្សាទុក',
    video: 'Video Engine', videoHelp: 'ម៉ាស៊ីន GPU ណាក៏បាន៖ Google Colab, RunPod ឬ server ផ្ទាល់ខ្លួន។ RunPod៖ https://api.runpod.ai/v2/<endpoint id>',
    urlPh: 'API URL (https://…)', keyPh: 'API key (Colab អាចទទេ)', connect: 'Connect', connecting: 'កំពុងភ្ជាប់…', connected: 'ភ្ជាប់បាន',
    notConnected: 'មិនទាន់ភ្ជាប់', gpu: 'GPU', model: 'AI model', workers: 'Workers', used: 'កំពុងប្រើ', refreshed: 'ធ្វើបច្ចុប្បន្នភាព',
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

export function CommandCenter({ open, onClose, t, language }: { open: boolean; onClose: () => void; t: Labels; language: 'en' | 'kh' }) {
  const c = copy[language];
  const [voiceKey, setVoice] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [workers, setWorkers] = useState<ConnectResult['workers']>();
  const [tasks, setTasks] = useState(0);
  const [updated, setUpdated] = useState('');
  const connectedRef = useRef(false);
  const flashTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setVoice(getVoiceKey());
    const ep = getVideoEndpoint();
    setUrl(ep.url); setKey(ep.key);
  }, [open]);

  const countTasks = useCallback(async () => {
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
    const ep = getVideoEndpoint();
    if (ep.url) void run('refresh', ep);
    const id = window.setInterval(() => {
      void countTasks();
      const cur = getVideoEndpoint();
      if (cur.url && connectedRef.current) void run('refresh', cur);
    }, 5000);
    return () => window.clearInterval(id);
  }, [open, run, countTasks]);

  if (!open) return null;

  const onVoice = (v: string) => {
    setVoice(v); setVoiceKey(v); setSavedFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1200);
  };
  const connect = () => {
    if (!url.trim()) { setStatus({ kind: 'bad', text: c.needUrl }); return; }
    const ep = { url: url.trim(), key: key.trim() };
    setVideoEndpoint(ep);
    void run('connect', ep);
  };
  const vramPct = pct(hw?.vramUsedGb, hw?.vramTotalGb);
  const diskPct = pct(hw?.diskUsedGb, hw?.diskTotalGb);

  return <div className="modal-backdrop" onMouseDown={onClose}><aside className="command-drawer" onMouseDown={(e) => e.stopPropagation()}>
    <div className="drawer-header"><h2>{t.commandCenter}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={t.close}><X size={20} /></button></div>
    <div className="drawer-content">
      <section className="cc-block">
        <div className="cc-title"><Mic2 size={15} /><strong>{c.voice}</strong>{savedFlash && <span className="cc-saved"><Check size={12} /> {c.saved}</span>}</div>
        <SecretInput value={voiceKey} onChange={onVoice} placeholder={c.voicePh} label={c.voice} />
        <p className="access-help">{c.voiceHelp}</p>
      </section>

      <section className="cc-block cc-video">
        <div className="cc-title"><Film size={15} /><strong>{c.video}</strong>
          <span className={`cc-dot ${status.kind === 'ok' ? 'on' : status.kind === 'testing' ? 'wait' : ''}`} />
        </div>
        <input className="studio-input" type="url" inputMode="url" aria-label="API URL" placeholder={c.urlPh} value={url} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => { setUrl(e.target.value); connectedRef.current = false; setStatus({ kind: 'idle', text: '' }); }} />
        <SecretInput value={key} onChange={(v) => { setKey(v); connectedRef.current = false; }} placeholder={c.keyPh} label="API key" />
        <p className="access-help">{c.videoHelp}</p>
        <button type="button" className="access-test" onClick={connect} disabled={status.kind === 'testing'}><Plug size={14} /> {status.kind === 'testing' ? c.connecting : c.connect}</button>
        {status.kind !== 'idle' && <div className={`access-status ${status.kind}`}>{status.text}</div>}

        <div className="performance-panel cc-monitor">
          <div className="performance-heading"><h3>{t.performance}</h3><Gauge size={19} /></div>
          <small className="cc-live">{status.kind === 'ok' ? `${c.live}${updated ? ` · ${c.refreshed} ${updated}` : ''}` : c.notConnected}</small>
          <div className="gpu-monitor-grid">
            <article><span>{hw?.gpu ?? c.gpu}</span><strong>{gbText(hw?.vramTotalGb)}</strong><small>{t.vram}{hw?.vramUsedGb !== undefined ? ` · ${gbText(hw.vramUsedGb)} ${c.used}` : ''}</small><div className="usage-bar"><i style={{ width: `${vramPct}%` }} /></div></article>
            <article><span>{t.storage}</span><strong>{gbText(hw?.diskTotalGb)}</strong><small>{hw?.diskUsedGb !== undefined ? `${gbText(hw.diskUsedGb)} ${c.used}` : t.storage}</small><div className="usage-bar"><i style={{ width: `${diskPct}%` }} /></div></article>
            <article><span>{c.model}</span><strong className="cc-model">{hw?.model ?? '—'}</strong>{workers && <small>{c.workers}: {workers.ready} ready · {workers.running} running</small>}</article>
            <article><span>{t.activeTasks}</span><strong>{String(tasks).padStart(2, '0')}</strong><div className="task-pips">{[0, 1, 2].map((i) => <i key={i} style={{ opacity: tasks > i ? 1 : 0.25 }} />)}</div></article>
          </div>
        </div>
      </section>
    </div>
    <button type="button" className="drawer-save" onClick={onClose}><Check size={16} /> {t.done}</button>
  </aside></div>;
}
