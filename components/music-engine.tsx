'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Clapperboard, FolderOpen, Lock, Pause, Play, Plus, Zap } from 'lucide-react';
import { getEngineEndpoint } from '@/lib/client/api';
import { getPod } from '@/lib/client/pod';
import { getVoiceBlob, listVoices, type VoiceMeta } from '@/lib/client/voiceStore';
import { browserClient } from '@/lib/supabase/browser';
import { cancelSong, followJob, parseSongScript, readMusicRec, startSong, type MixPreset, type Register, type StepState } from '@/lib/client/musicEngine';

const copy = {
  en: { voice: '🎙️ Signature Voice', voicePh: 'Choose a voice…', upload: 'Upload', locked: '🔒 Signature Voice Locked', title: '🏷️ Song Title / File Name', titlePh: 'Leave empty to take the title from the script', script: '📄 Full Song Script', scriptPh: 'Paste the whole ChatGPT song output (Package 1 Lyrics, Package 2 Style/BPM/Key, Package 3 Mix Notes…)',
    adv: '⚙️ Advanced', register: 'Vocal register', auto: 'Auto', male: 'Male', female: 'Female', pitch: 'Pitch shift', preset: 'Studio mix', lock: 'Duration lock 3:33', seed: 'Seed (empty = random)',
    render: '⚡ RENDER SONG (.MP3)', ready: 'RunPod ready', notReady: 'RunPod not connected', cmd: 'Command Center', cancel: 'Cancel', openDoc: '📁 Open in Document', toTimeline: '🎬 Send to Timeline Editor', step: 'Step', elapsed: 'Elapsed',
    delivered: (n: string) => `✅ ${n} is ready and waiting in Document (Supabase)!`, presets: { auto: 'Auto', warm: 'Warm Emotional', close: 'Close-Mic', stadium: 'Stadium', raw: 'Raw Scream Safe' },
    ok: (s: number, bpm: number | null) => `✅ Ready: ${s} Sections Lyrics · Style Prompt · ${bpm ?? '?'} BPM · 3:33 Lock`, bad: '⚠️ Lyrics or Style Prompt not detected yet — paste ChatGPT song output' },
  kh: { voice: '🎙️ សំឡេង Signature របស់អ្នក — ដាច់ខាត', voicePh: 'ជ្រើសរើសសំឡេង…', upload: 'Upload', locked: '🔒 សំឡេងអ្នក ១០០%', title: '🏷️ ចំណងជើងបទ / ឈ្មោះឯកសារ .mp3', titlePh: 'ទុកទទេ ដើម្បីយកចំណងជើងពី script ស្វ័យប្រវត្តិ', script: '📄 Full Song Script (ទម្លាក់កញ្ចប់អក្សរទាំងមូលពី ChatGPT)', scriptPh: 'បិទភ្ជាប់លទ្ធផលបទទាំងមូលពី ChatGPT (Package 1 Lyrics, Package 2 Style/BPM/Key, Package 3 Mix Notes…)',
    adv: '⚙️ ការកំណត់បន្ថែម / Advanced', register: 'Vocal register', auto: 'ស្វ័យប្រវត្តិ', male: 'ប្រុស', female: 'ស្រី', pitch: 'Pitch shift', preset: 'Studio mix', lock: 'ចាក់សោរ 3:33', seed: 'Seed (ទទេ = ចៃដន្យ)',
    render: '⚡ RENDER SONG (.MP3)', ready: 'RunPod រួចរាល់', notReady: 'RunPod មិនទាន់ភ្ជាប់', cmd: 'Command Center', cancel: 'បោះបង់', openDoc: '📁 បើកក្នុង Document', toTimeline: '🎬 ផ្ញើទៅ Timeline Editor', step: 'Step', elapsed: 'រយៈពេល',
    delivered: (n: string) => `✅ ${n} រួចរាល់ និងបានផ្ញើទៅរង់ចាំក្នុង Document (Supabase) ហើយ!`, presets: { auto: 'ស្វ័យប្រវត្តិ', warm: 'Warm Emotional', close: 'Close-Mic', stadium: 'Stadium', raw: 'Raw Scream Safe' },
    ok: (s: number, bpm: number | null) => `✅ Ready: ${s} Sections Lyrics · Style Prompt · ${bpm ?? '?'} BPM · 3:33 Lock`, bad: '⚠️ Lyrics or Style Prompt not detected yet — paste ChatGPT song output' },
} as const;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const RVC = /\.(pth|index)$/i;

/** Ultra-minimal Music Engine: 3 inputs + 1 render button; the whole pipeline runs on RunPod and the .mp3 lands in Document. */
export function MusicEngine({ language, active, onOpenDocument, onSendMusic, onNotice }: { language: 'en' | 'kh'; active: boolean; onOpenDocument: () => void; onSendMusic: (f: File) => void | Promise<void>; onNotice: (m: string) => void }) {
  const c = copy[language];
  const [voices, setVoices] = useState<VoiceMeta[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [uploaded, setUploaded] = useState<File | null>(null);
  const [adapter, setAdapter] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [advOpen, setAdvOpen] = useState(false);
  const [register, setRegister] = useState<Register>('auto');
  const [pitch, setPitch] = useState(0);
  const [preset, setPreset] = useState<MixPreset>('auto');
  const [lock, setLock] = useState(true);
  const [seed, setSeed] = useState('');
  const [st, setSt] = useState<StepState | null>(null);
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [ready, setReady] = useState(false);
  const stop = useRef(false);
  const aud = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => parseSongScript(script), [script]);
  useEffect(() => { if (!active) return; void listVoices().then(setVoices).catch(() => undefined); setReady(!!(getEngineEndpoint('music').url || getPod().podId)); }, [active]);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'nearest' }); }, [st?.logs.length]);
  useEffect(() => () => aud.current?.pause(), []);

  const finish = useCallback(async (s: StepState) => {
    setSt(s);
    if (s.done || s.error) { setRunning(false); }
    if (s.done && s.path) { const r = await browserClient().storage.from('documents').createSignedUrl(s.path, 3600); if (r.data) setUrl(r.data.signedUrl); }
  }, []);

  // reopening the app mid-render (phone was locked): keep following the same GPU job
  useEffect(() => {
    const rec = readMusicRec(); if (!rec) return;
    stop.current = false; setRunning(true);
    void followJob(rec, (s) => void finish(s), () => stop.current);
    return () => { stop.current = true; };
  }, [finish]);

  const voiceFile = async (): Promise<File | null> => {
    if (uploaded) return uploaded;
    const v = voices.find((x) => x.id === voiceId); if (!v) return null;
    const b = await getVoiceBlob(v.id); return b ? new File([b], `${v.name}.mp3`, { type: b.type || 'audio/mpeg' }) : null;
  };
  const haveVoice = !!uploaded || !!voices.find((x) => x.id === voiceId);
  const canRender = haveVoice && parsed.ok && !running;

  const pick = (files: FileList | null) => {
    const list = Array.from(files ?? []); if (!list.length) return;
    const model = list.find((f) => /\.pth$/i.test(f.name)); const idx = list.find((f) => /\.index$/i.test(f.name)); const audio = list.find((f) => !RVC.test(f.name));
    if (model) { setUploaded(model); setAdapter(idx ?? null); } else if (audio) { setUploaded(audio); setAdapter(null); } else { onNotice('Choose .wav / .mp3 / .m4a or a .pth model.'); return; }
    setVoiceId('');
  };
  const preview = async () => {
    if (previewing) { aud.current?.pause(); setPreviewing(false); return; }
    const f = await voiceFile(); if (!f || RVC.test(f.name)) return;
    const a = new Audio(URL.createObjectURL(f)); aud.current = a; a.onended = () => setPreviewing(false); setPreviewing(true); await a.play().catch(() => setPreviewing(false));
  };
  const render = async () => {
    const v = await voiceFile(); if (!v) { onNotice('Choose your Signature Voice first.'); return; }
    stop.current = false; setRunning(true); setUrl(''); setSt({ step: 1, percent: 0, logs: [], error: '', done: false, elapsed: 0 });
    const n = Number(seed);
    await startSong({ voice: v, adapter, title, parsed, register, pitch, preset, lock, seed: seed.trim() && Number.isFinite(n) ? Math.floor(n) : null }, (s) => void finish(s), () => stop.current);
  };
  const cancel = async () => { stop.current = true; await cancelSong(); setRunning(false); setSt(null); };
  const toTimeline = async () => {
    if (!st?.path) return;
    const r = await browserClient().storage.from('documents').download(st.path);
    if (r.error || !r.data) { onNotice(r.error?.message ?? 'Download failed'); return; }
    await onSendMusic(new File([r.data], st.name ?? 'song.mp3', { type: 'audio/mpeg' }));
  };

  // live elapsed clock while running
  const [tick, setTick] = useState(0);
  useEffect(() => { if (!running) return; const id = window.setInterval(() => setTick((n) => n + 1), 1000); return () => window.clearInterval(id); }, [running]);
  void tick;

  return <section className="screen-card music-engine">
    <div className="me-block">
      <label className="field-label">{c.voice}</label>
      <div className="me-row">
        <select className="studio-input" value={uploaded ? '__upload' : voiceId} onChange={(e) => { setUploaded(null); setAdapter(null); setVoiceId(e.target.value); }} disabled={running}>
          <option value="">{c.voicePh}</option>
          {uploaded && <option value="__upload">{uploaded.name}{adapter ? ` + ${adapter.name}` : ''}</option>}
          {voices.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.type}</option>)}
        </select>
        <button type="button" className="tl-pill" onClick={() => fileRef.current?.click()} disabled={running}><Plus size={15} /> {c.upload}</button>
        <button type="button" className="icon-button" onClick={() => void preview()} disabled={!haveVoice} aria-label="Preview">{previewing ? <Pause size={17} /> : <Play size={17} />}</button>
        <input ref={fileRef} type="file" hidden multiple accept="audio/*,.wav,.mp3,.m4a,.pth,.index" onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
      </div>
      <small className="me-lock"><Lock size={12} /> {c.locked}</small>
    </div>

    <div className="me-block">
      <label className="field-label" htmlFor="me-title">{c.title}</label>
      <input id="me-title" className="studio-input" value={title} maxLength={80} placeholder={parsed.title || c.titlePh} disabled={running} onChange={(e) => setTitle(e.target.value)} />
    </div>

    <div className="me-block">
      <label className="field-label" htmlFor="me-script">{c.script}</label>
      <textarea id="me-script" className="studio-textarea me-script" value={script} placeholder={c.scriptPh} disabled={running} onChange={(e) => setScript(e.target.value)} />
      {script.trim() && <div className={`me-check ${parsed.ok ? 'ok' : 'warn'}`}>{parsed.ok ? c.ok(parsed.sections, parsed.bpm) : c.bad}</div>}
      <button type="button" className="me-adv" aria-expanded={advOpen} onClick={() => setAdvOpen((v) => !v)}>{c.adv}<ChevronDown size={16} style={{ transform: advOpen ? 'rotate(180deg)' : undefined }} /></button>
      {advOpen && <div className="me-adv-body">
        <label>{c.register}<select className="studio-input" value={register} onChange={(e) => setRegister(e.target.value as Register)}><option value="auto">{c.auto}</option><option value="male">{c.male}</option><option value="female">{c.female}</option></select></label>
        <label>{c.pitch}: {pitch > 0 ? `+${pitch}` : pitch}<input type="range" min={-12} max={12} step={1} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} /></label>
        <label>{c.preset}<select className="studio-input" value={preset} onChange={(e) => setPreset(e.target.value as MixPreset)}>{(Object.keys(c.presets) as MixPreset[]).map((k) => <option key={k} value={k}>{c.presets[k]}</option>)}</select></label>
        <label className="me-check-row"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> {c.lock}</label>
        <label>{c.seed}<input className="studio-input" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 9))} /></label>
      </div>}
    </div>

    <button type="button" className="primary-button generate-button" disabled={!canRender} onClick={() => void render()}><Zap size={16} /> {c.render}</button>
    <small className="me-ready"><i className={ready ? 'on' : ''} /> {ready ? c.ready : <>{c.notReady} · {c.cmd}</>}</small>

    {st && <div className="me-term" role="status" aria-live="polite">
      <div className="me-term-head"><span>{c.step} {Math.max(1, st.step)} / 7</span><span>{st.percent}%</span><span>{c.elapsed} {mmss(running ? Math.round((Date.now() - (readMusicRec()?.startedAt ?? Date.now() - st.elapsed * 1000)) / 1000) : st.elapsed)}</span></div>
      <div className="me-bar"><i style={{ width: `${st.percent}%` }} /></div>
      <pre>{st.logs.join('\n')}{st.error ? `\n✕ ${st.error}` : ''}<span ref={logEnd} /></pre>
      {running && <button type="button" className="text-button" onClick={() => void cancel()}>{c.cancel}</button>}
    </div>}

    {st?.done && <div className="me-done">
      <strong>{c.delivered(st.name ?? 'Song.mp3')}</strong>
      {url && <audio controls src={url} preload="none" />}
      <div className="me-done-btns"><button type="button" className="tl-pill" onClick={onOpenDocument}><FolderOpen size={15} /> {c.openDoc}</button><button type="button" className="tl-pill" onClick={() => void toTimeline()}><Clapperboard size={15} /> {c.toTimeline}</button></div>
    </div>}
  </section>;
}
