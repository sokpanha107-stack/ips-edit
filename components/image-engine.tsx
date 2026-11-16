'use client';

import { api } from '@/lib/client/api';
import { useEffect, useRef, useState } from 'react';
import { Check, Download, ImagePlus, Lock, Send, Sparkles, Unlock, X } from 'lucide-react';
import { cancelImageJob, fetchImageFile, imageStatus, parsePrompts, startImageJob, type ImageJob, type ImageOptions, type ImageStatus } from '@/lib/client/imageEngine';

const copy = {
  en: { eyebrow: 'Image Engine', signature: 'Signature Image', sigHelp: 'The base picture. Every scene keeps this character and style.', pick: 'Choose or drop image', lock: 'Lock', unlock: 'Unlock',
    prompts: 'Scene prompts', promptsHelp: 'One prompt per line · up to 100', ph: 'a girl walking in a sunny garden\na girl reading a book at night\n…', suffix: 'Style added to every prompt (optional)',
    format: 'Format', similar: 'Similarity to Signature', steps: 'Quality', fast: 'Fast', normal: 'Normal', seed: 'Seed (optional)', go: 'Generate images', busy: 'Generating…', cancel: 'Cancel',
    results: 'Results', sent: 'In the Timeline media bin', noEp: 'Connect your Image Engine first (menu → Command Center → Image Engine).', runpod: 'The Image Engine needs the Colab (or your own) server; RunPod serverless cannot take this batch.', needSig: 'Choose the Signature Image first.', needPrompts: 'Write at least one scene prompt.', tooMany: 'Maximum is 100 prompts per batch.', done: 'All images are ready and sent to the Timeline.' },
  kh: { eyebrow: 'Image Engine', signature: 'Signature Image', sigHelp: 'រូបគំរូមូលដ្ឋាន។ គ្រប់ scene រក្សាតួអង្គ និងស្ទីលនេះ។', pick: 'ជ្រើស ឬទម្លាក់រូប', lock: 'Lock', unlock: 'Unlock',
    prompts: 'Prompt សម្រាប់ scene', promptsHelp: 'មួយបន្ទាត់ក្នុងមួយ prompt · ច្រើនបំផុត 100', ph: 'a girl walking in a sunny garden\na girl reading a book at night\n…', suffix: 'ស្ទីលបន្ថែមលើគ្រប់ prompt (ជម្រើស)',
    format: 'ទម្រង់', similar: 'ភាពដូច Signature', steps: 'គុណភាព', fast: 'លឿន', normal: 'ធម្មតា', seed: 'Seed (ជម្រើស)', go: 'បង្កើតរូបភាព', busy: 'កំពុងបង្កើត…', cancel: 'បោះបង់',
    results: 'លទ្ធផល', sent: 'ក្នុង Media Bin របស់ Timeline', noEp: 'សូមភ្ជាប់ Image Engine សិន (menu → Command Center → Image Engine)។', runpod: 'Image Engine ត្រូវការ Colab (ឬ server ផ្ទាល់ខ្លួន)។ RunPod serverless មិនអាចទទួល batch នេះទេ។', needSig: 'សូមជ្រើស Signature Image សិន។', needPrompts: 'សូមសរសេរ prompt យ៉ាងតិចមួយ។', tooMany: 'ច្រើនបំផុត 100 prompt ក្នុងមួយ batch។', done: 'រូបភាពទាំងអស់រួចរាល់ ហើយបានផ្ញើទៅ Timeline។' },
} as const;

const FORMATS = { '9:16': { width: 768, height: 1344, fastW: 576, fastH: 1024 }, '16:9': { width: 1344, height: 768, fastW: 1024, fastH: 576 }, '1:1': { width: 1024, height: 1024, fastW: 768, fastH: 768 } } as const;
type Fmt = keyof typeof FORMATS;
const DRAFT = 'ips-image-draft';

export function ImageEngine({ language, onImages, onNotice }: { language: 'en' | 'kh'; onImages: (files: File[]) => Promise<void> | void; onNotice: (m: string) => void }) {
  const c = copy[language];
  const [sig, setSig] = useState<File | null>(null);
  const [sigUrl, setSigUrl] = useState('');
  const [locked, setLocked] = useState(false);
  const [raw, setRaw] = useState('');
  const [suffix, setSuffix] = useState('');
  const [fmt, setFmt] = useState<Fmt>('9:16');
  const [scale, setScale] = useState(0.6);
  const [fast, setFast] = useState(false);
  const [seed, setSeed] = useState('');
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [st, setSt] = useState<ImageStatus | null>(null);
  const [err, setErr] = useState('');
  const [thumbs, setThumbs] = useState<{ name: string; url: string }[]>([]);
  const jobRef = useRef<ImageJob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { try { const d = JSON.parse(localStorage.getItem(DRAFT) ?? '{}'); if (typeof d.raw === 'string') setRaw(d.raw); if (typeof d.suffix === 'string') setSuffix(d.suffix); } catch { /* ignore */ } }, []);
  useEffect(() => { try { localStorage.setItem(DRAFT, JSON.stringify({ raw, suffix })); } catch { /* ignore */ } }, [raw, suffix]);

  const pickFile = (f?: File | null) => {
    if (!f || locked) return;
    if (!f.type.startsWith('image/')) { onNotice('That is not an image.'); return; }
    if (sigUrl) URL.revokeObjectURL(sigUrl);
    setSig(f); setSigUrl(URL.createObjectURL(f));
  };
  const prompts = parsePrompts(raw, suffix);
  const busy = phase === 'busy';

  const generate = async () => {
    setErr('');
    if (!sig) { setErr(c.needSig); return; }
    if (!prompts.length) { setErr(c.needPrompts); return; }
    if (prompts.length > 100) { setErr(c.tooMany); return; }
    const f = FORMATS[fmt];
    const opt: ImageOptions = { width: fast ? f.fastW : f.width, height: fast ? f.fastH : f.height, scale, steps: fast ? 20 : 30, seed, negative: '' };
    setPhase('busy'); setSt(null); setThumbs([]);
    try {
      const job = await startImageJob(sig, prompts, opt);
      jobRef.current = job;
      const seen = new Set<number>();
      for (;;) {
        await new Promise((r) => setTimeout(r, 1200));
        if (jobRef.current?.id !== job.id) return;
        const s = await imageStatus(job);
        setSt(s);
        for (const im of s.images) {          // each finished picture goes straight into the Timeline's media bin
          if (seen.has(im.index)) continue;
          seen.add(im.index);
          const file = await fetchImageFile(im.url, im.name);
          await onImages([file]);
          setThumbs((t) => [...t, { name: im.name, url: URL.createObjectURL(file) }]);
        }
        if (s.status === 'DONE') {
          setPhase('done'); onNotice(c.done);
          // file the pictures into a new Document folder + push notification (best effort: never blocks the Timeline)
          void api.fileOutputs('image', `Images ${prompts.length}`, s.images.map((im) => ({ name: im.name, url: im.url }))).catch(() => undefined);
          return;
        }
        if (s.status === 'FAILED' || s.status === 'CANCELLED') { setPhase('error'); setErr(s.status === 'CANCELLED' ? 'Cancelled.' : s.error || 'Image generation failed.'); return; }
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Failed';
      setPhase('error'); setErr(m === 'NO_ENDPOINT' ? c.noEp : m === 'RUNPOD' ? c.runpod : m);
    }
  };
  const cancel = async () => { const j = jobRef.current; jobRef.current = null; if (j) await cancelImageJob(j); setPhase('idle'); };

  return <section className="screen-card engine-screen image-screen">
    <div className="screen-heading"><div className="section-heading"><div className="heading-icon"><Sparkles size={18} /></div><div className="heading-only"><span className="eyebrow">{c.eyebrow}</span></div></div></div>
    <div className="image-grid">
      <div className="image-sig">
        <div className="tool-row"><span className="tool-label">{c.signature}</span>
          <button type="button" className="text-button" onClick={() => setLocked((v) => !v)}>{locked ? <><Lock size={13} /> {c.unlock}</> : <><Unlock size={13} /> {c.lock}</>}</button></div>
        <div className="sig-drop" onClick={() => !locked && fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0]); }}>
          {sigUrl ? <img src={sigUrl} alt="Signature" /> : <span><ImagePlus size={26} /><em>{c.pick}</em></span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
        <p className="access-help">{c.sigHelp}</p>
      </div>
      <div className="image-form">
        <div className="tool-row"><span className="tool-label">{c.prompts} · {prompts.length}/100</span></div>
        <textarea className="studio-textarea" rows={9} value={raw} placeholder={c.ph} onChange={(e) => setRaw(e.target.value)} disabled={busy} />
        <p className="access-help">{c.promptsHelp}</p>
        <input className="studio-input" value={suffix} placeholder={c.suffix} onChange={(e) => setSuffix(e.target.value)} disabled={busy} />
      </div>
    </div>
    <div className="tl-grid">
      <label>{c.format}<select className="studio-input" value={fmt} onChange={(e) => setFmt(e.target.value as Fmt)} disabled={busy}>{Object.keys(FORMATS).map((k) => <option key={k}>{k}</option>)}</select></label>
      <label>{c.similar} {Math.round(scale * 100)}%<input type="range" min={0.2} max={1} step={0.05} value={scale} onChange={(e) => setScale(Number(e.target.value))} disabled={busy} /></label>
      <label>{c.steps}<select className="studio-input" value={fast ? 'fast' : 'normal'} onChange={(e) => setFast(e.target.value === 'fast')} disabled={busy}><option value="normal">{c.normal}</option><option value="fast">{c.fast}</option></select></label>
      <label>{c.seed}<input className="studio-input" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} disabled={busy} /></label>
    </div>
    <button type="button" className="primary-button big-copy" onClick={generate} disabled={busy}><Send size={16} /> {busy ? c.busy : `${c.go} · ${prompts.length}`}</button>
    {busy && <div className="tl-progress"><div className="tl-bar-track"><i style={{ width: `${st?.progress ?? 2}%` }} /></div>
      <span>{`⏳ ${st?.stage ?? 'Starting'} · ${st?.done ?? 0}/${st?.total ?? prompts.length}`}</span><button type="button" className="text-button" onClick={cancel}><X size={13} /> {c.cancel}</button></div>}
    {phase === 'done' && <div className="access-status ok"><Check size={13} /> {c.done}</div>}
    {err && <div className="access-status bad">{err}</div>}
    {thumbs.length > 0 && <>
      <div className="tool-label">{c.results} · {thumbs.length} · {c.sent}</div>
      <ul className="img-results">{thumbs.map((t) => <li key={t.name}><img src={t.url} alt={t.name} /><span>{t.name}</span><a href={t.url} download={t.name} aria-label={`Download ${t.name}`}><Download size={13} /></a></li>)}</ul>
    </>}
  </section>;
}
