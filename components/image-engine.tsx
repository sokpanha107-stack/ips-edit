'use client';

import { podAcquire, podRelease } from '@/lib/client/pod';
import { setBatchProgress } from '@/lib/client/progress';
import { api, getEngineEndpoint } from '@/lib/client/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, Play, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { cancelImageJob, fetchImageFile, imageStatus, parsePrompts, startImageJob, type ImageJob, type ImageOptions } from '@/lib/client/imageEngine';
import { OptionsPanel, RefBar, cropToAspect, dataUrlToFile, readSavedRef, useEngineConfig, type Aspect } from '@/components/engine-kit';

const copy = {
  en: { folder: 'Folder name', count: 'Scene count', master: 'Master prompt', masterPh: 'Style added to every scene (optional)', scripts: 'Batch scripts', scriptsPh: 'One scene prompt per line · up to 100\na girl walking in a sunny garden\na girl reading a book at night', required: 'Required', optional: 'Optional',
    go: 'Generate images', cancel: 'Cancel', resume: 'Resume', results: 'Results', sent: 'In the Timeline media bin',
    noEp: 'Connect your Image Engine first (menu → Command Center → Image Engine).', runpod: 'The Image Engine needs the Colab (or your own) server; RunPod serverless cannot take this batch.',
    needRef: 'Choose the reference image first.', needFolder: 'Enter a folder name.', needCount: 'Enter the scene count.', needPrompts: 'Write at least one scene prompt.', tooMany: 'Maximum is 100 scenes per batch.',
    mismatch: (n: number, w: number) => `Scripts have ${n} scenes but the count is ${w}.`, ok: 'Verified', done: 'All images are ready, saved in Document and sent to the Timeline.',
    paused: (d: number, n: number) => `Connection lost after Scene ${d}. Saved scenes are safe. Resume continues at Scene ${n}.`, resumed: (n: number) => `Resuming at Scene ${n}…`, locked: 'Locked: settings and reference are frozen.' },
  kh: { folder: 'ឈ្មោះ Folder', count: 'ចំនួន Scene', master: 'Master prompt', masterPh: 'ស្ទីលបន្ថែមលើគ្រប់ Scene (ជម្រើស)', scripts: 'Batch scripts', scriptsPh: 'មួយបន្ទាត់ក្នុងមួយ Scene · ច្រើនបំផុត 100\na girl walking in a sunny garden\na girl reading a book at night', required: 'ត្រូវការ', optional: 'ជម្រើស',
    go: 'បង្កើតរូបភាព', cancel: 'បោះបង់', resume: 'បន្ត', results: 'លទ្ធផល', sent: 'ក្នុង Media Bin របស់ Timeline',
    noEp: 'សូមភ្ជាប់ Image Engine សិន (menu → Command Center → Image Engine)។', runpod: 'Image Engine ត្រូវការ Colab (ឬ server ផ្ទាល់ខ្លួន)។ RunPod serverless មិនអាចទទួល batch នេះទេ។',
    needRef: 'សូមជ្រើសរូបគំរូសិន។', needFolder: 'សូមបញ្ចូលឈ្មោះ Folder។', needCount: 'សូមបញ្ចូលចំនួន Scene។', needPrompts: 'សូមសរសេរ prompt យ៉ាងតិចមួយ។', tooMany: 'ច្រើនបំផុត 100 Scene ក្នុងមួយ batch។',
    mismatch: (n: number, w: number) => `Script មាន ${n} Scene ប៉ុន្តែចំនួនកំណត់ ${w}។`, ok: 'ផ្ទៀងផ្ទាត់រួច', done: 'រូបភាពទាំងអស់រួចរាល់ រក្សាទុកក្នុង Document និងផ្ញើទៅ Timeline។',
    paused: (d: number, n: number) => `ដាច់ការតភ្ជាប់បន្ទាប់ពី Scene ${d}។ Scene ដែលបានរក្សាទុកមានសុវត្ថិភាព។ ចុចបន្តដើម្បីចាប់ពី Scene ${n}។`, resumed: (n: number) => `កំពុងបន្តពី Scene ${n}…`, locked: 'Lock៖ ការកំណត់ និងរូបគំរូត្រូវបានបង្កក។' },
} as const;

const FORMATS = { '9:16': { width: 768, height: 1344, fastW: 576, fastH: 1024 }, '16:9': { width: 1344, height: 768, fastW: 1024, fastH: 576 }, '1:1': { width: 1024, height: 1024, fastW: 768, fastH: 768 } } as const;
const DRAFT = 'ips-image-draft';
const JOBKEY = 'ips-image-job';
const pad = (i: number) => String(i + 1).padStart(3, '0');

/** What survives a reload: the GPU job, the Document folder, and which scenes are already safely saved. */
interface Rec { job: ImageJob; folder: string; prompts: string[]; offset: number; folderId?: string; saved: number[]; opt: ImageOptions; aspect: Aspect }
const readRec = (): Rec | null => { try { return JSON.parse(localStorage.getItem(JOBKEY) || 'null'); } catch { return null; } };
const writeRec = (r: Rec | null) => { try { if (r) localStorage.setItem(JOBKEY, JSON.stringify(r)); else localStorage.removeItem(JOBKEY); } catch { /* ignore */ } };
/** Contiguous count of saved scenes from Scene 1 = where a restart continues. */
const nextIndex = (r: Rec) => { const s = new Set(r.saved); let i = 0; while (s.has(i)) i += 1; return i; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ImageEngine({ language, onImages, onNotice }: { language: 'en' | 'kh'; onImages: (files: File[]) => Promise<void> | void; onNotice: (m: string) => void }) {
  const c = copy[language];
  const cfg = useEngineConfig('image');
  const { opts } = cfg;
  const [folder, setFolder] = useState('');
  const [count, setCount] = useState('');
  const [master, setMaster] = useState('');
  const [raw, setRaw] = useState('');
  const [phase, setPhase] = useState<'idle' | 'busy' | 'paused' | 'done' | 'error'>('idle');
  const [wake, setWake] = useState('');
  const [doneN, setDoneN] = useState(0);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [thumbs, setThumbs] = useState<{ name: string; url: string }[]>([]);
  const runId = useRef(0);
  const added = useRef(new Set<number>());   // scenes already placed in the Timeline media bin this session
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => { try { const d = JSON.parse(localStorage.getItem(DRAFT) ?? '{}'); if (typeof d.raw === 'string') setRaw(d.raw); if (typeof d.master === 'string') setMaster(d.master); if (typeof d.folder === 'string') setFolder(d.folder); if (typeof d.count === 'string') setCount(d.count); } catch { /* ignore */ } setDraftLoaded(true); }, []);
  useEffect(() => { if (!draftLoaded) return; try { localStorage.setItem(DRAFT, JSON.stringify({ raw, master, folder, count })); } catch { /* ignore */ } }, [draftLoaded, raw, master, folder, count]);

  const prompts = parsePrompts(raw, master);
  const wanted = Number(count);
  const busy = phase === 'busy';
  const active = busy || phase === 'paused';
  let problem = '';
  if (!cfg.ref) problem = c.needRef;
  else if (!folder.trim()) problem = c.needFolder;
  else if (!wanted) problem = c.needCount;
  else if (!prompts.length) problem = c.needPrompts;
  else if (prompts.length > 100 || wanted > 100) problem = c.tooMany;
  else if (prompts.length !== wanted) problem = c.mismatch(prompts.length, wanted);
  const ready = problem === '';

  /** Starts (or restarts) the GPU job for every scene not yet saved. */
  const launch = useCallback(async (r: Rec): Promise<Rec> => {
    const from = nextIndex(r);
    const ref = readSavedRef('image');
    if (!ref) throw new Error('Reference image is missing.');
    const ep0 = getEngineEndpoint('image');
    const sig = await dataUrlToFile(await cropToAspect(ref.url, r.aspect), ref.name);
    await podAcquire('image', ep0.url, (m) => setWake(m), () => false);
    setWake('');
    const job = await startImageJob(sig, r.prompts.slice(from), r.opt);
    return { ...r, job, offset: from };
  }, []);

  const latest = useRef({ launch, onImages, onNotice, c });
  latest.current = { launch, onImages, onNotice, c };

  /** The checkpoint loop: poll, save each finished scene to the cloud at once, survive drops, finish with one notification. */
  const run = useCallback(async (start: Rec) => {
    const my = ++runId.current;
    let rec = start; let netFails = 0;
    setPhase('busy'); setErr(''); setTotal(rec.prompts.length); setDoneN(rec.saved.length);
    const live = () => runId.current === my;
    for (;;) {
      await wait(1200);
      if (!live()) return;
      try {
        const s = await imageStatus(rec.job);
        netFails = 0;
        for (const im of s.images) {
          const g = rec.offset + im.index;
          if (rec.saved.includes(g)) continue;
          const name = `scene-${pad(g)}.png`;
          const res = await api.fileOutputs('image', rec.folder, [{ name, url: im.url }], { folderId: rec.folderId, notify: false });
          if (!res.saved) continue;                                   // not stored yet: retry on the next pass
          rec = { ...rec, folderId: res.folderId, saved: [...rec.saved, g] }; writeRec(rec);
          if (!live()) return;
          setDoneN(rec.saved.length); setBatchProgress({ label: 'Image', done: rec.saved.length, total: rec.prompts.length });
          if (!added.current.has(g)) {
            added.current.add(g);
            try { const f = await fetchImageFile(im.url, name); await latest.current.onImages([f]); setThumbs((t) => [...t, { name, url: URL.createObjectURL(f) }]); } catch { /* the cloud copy is already safe */ }
          }
        }
        if (rec.saved.length >= rec.prompts.length) {
          await api.fileOutputs('image', rec.folder, [], { folderId: rec.folderId, notify: true }).catch(() => undefined);
          writeRec(null); setBatchProgress(null); void podRelease('image'); setPhase('done'); latest.current.onNotice(latest.current.c.done); return;
        }
        if (s.status === 'FAILED' || s.status === 'CANCELLED') throw Object.assign(new Error(s.error || 'job stopped'), { lost: true });
        if (s.status === 'DONE') throw Object.assign(new Error('incomplete'), { lost: true });   // finished but some scenes were not saved: restart those
      } catch (e) {
        if (!live()) return;
        const lost = (e as { lost?: boolean }).lost || !(e instanceof TypeError);       // network drop = TypeError; anything else = the GPU forgot the job
        if (!lost) { netFails += 1; if (netFails < 20) { await wait(3000); continue; } }
        try { rec = await latest.current.launch(rec); writeRec(rec); latest.current.onNotice(latest.current.c.resumed(nextIndex(rec) + 1)); netFails = 0; continue; }
        catch { setBatchProgress(null); setPhase('paused'); setErr(latest.current.c.paused(nextIndex(rec), nextIndex(rec) + 1)); return; }
      }
    }
  }, []);

  // State check on (re)start: a saved record means a batch was interrupted, so continue after the last saved scene.
  useEffect(() => { const r = readRec(); if (r && r.saved.length < r.prompts.length) void run(r); return () => { runId.current += 1; }; }, [run]);
  useEffect(() => {   // coming back online resumes a paused batch
    const on = () => { const r = readRec(); if (r && phase === 'paused') void run(r); };
    window.addEventListener('online', on); return () => window.removeEventListener('online', on);
  }, [phase, run]);

  const generate = async () => {
    if (!ready || !cfg.ref) return;
    setErr(''); setThumbs([]); added.current = new Set(); setPhase('busy'); setTotal(prompts.length); setDoneN(0);
    const f = FORMATS[opts.aspect];
    const opt: ImageOptions = { width: opts.fast ? f.fastW : f.width, height: opts.fast ? f.fastH : f.height, scale: opts.similarity, steps: opts.fast ? 20 : 30, seed: opts.seed, negative: '' };
    try {
      const base: Rec = { job: { id: '', base: '', key: '' }, folder: folder.trim(), prompts, offset: 0, saved: [], opt, aspect: opts.aspect };
      const rec = await launch(base); writeRec(rec); void run(rec);
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Failed';
      void podRelease('image'); setWake('');
      setPhase('error'); setErr(m === 'NO_ENDPOINT' ? c.noEp : m === 'RUNPOD' ? c.runpod : m);
    }
  };
  const cancel = async () => { runId.current += 1; const r = readRec(); writeRec(null); setBatchProgress(null); if (r) await cancelImageJob(r.job); void podRelease('image'); setWake(''); setPhase('idle'); setErr(''); };
  const resumeNow = () => { const r = readRec(); if (r) void run(r); };

  return <section className="screen-card engine-screen image-screen">
    <div className="screen-heading"><div className="section-heading"><div className="heading-icon"><Sparkles size={18} /></div><div className="heading-only"><span className="eyebrow">Image Engine</span></div></div></div>
    <RefBar cfg={cfg} onNotice={onNotice} />
    {cfg.locked && <p className="access-help">{c.locked}</p>}
    <div className="job-fields">
      <div><label className="field-label" htmlFor="img-folder">{c.folder} <span>{c.required}</span></label><input id="img-folder" className="studio-input" value={folder} maxLength={60} disabled={active} onChange={(e) => setFolder(e.target.value.replace(/[\\/:*?"<>|]/g, '-'))} /></div>
      <div><label className="field-label" htmlFor="img-count">{c.count} <span>{c.required}</span></label><input id="img-count" className="studio-input" inputMode="numeric" value={count} maxLength={3} placeholder="0" disabled={active} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))} /></div>
    </div>
    <label className="field-label">{c.master} <span>{c.optional}</span></label>
    <input className="studio-input" value={master} placeholder={c.masterPh} disabled={active} onChange={(e) => setMaster(e.target.value)} />
    <label className="field-label">{c.scripts} <span>{c.required} · {prompts.length}/100</span></label>
    <textarea className="studio-textarea" value={raw} placeholder={c.scriptsPh} disabled={active} onChange={(e) => setRaw(e.target.value)} />
    <OptionsPanel language={language} opts={opts} onChange={cfg.setOpts} disabled={active} />
    {!active && phase !== 'done' && <div className={`scene-check ${ready ? 'ok' : prompts.length ? 'bad' : 'neutral'}`}>{ready ? <Check size={14} /> : <ShieldCheck size={14} />}<span>{ready ? `${c.ok} · ${prompts.length}` : problem}</span></div>}
    {!active && <button type="button" className="primary-button generate-button" disabled={!ready} onClick={() => void generate()}><Send size={16} /> {phase === 'done' ? `${c.go} · ${prompts.length}` : c.go}</button>}
    {busy && <div className="tl-progress"><div className="tl-bar-track"><i style={{ width: `${total ? Math.max(2, (doneN / total) * 100) : 2}%` }} /></div>
      <span>{wake ? `⚡ ${wake}` : `⏳ ${Math.min(total, doneN + 1)}/${total}`}</span><button type="button" className="text-button" onClick={() => void cancel()}><X size={13} /> {c.cancel}</button></div>}
    {phase === 'paused' && <><div className="paused-box">⚠ {err}</div><button type="button" className="resume-button" onClick={resumeNow}><Play size={15} fill="currentColor" /> {c.resume}</button><button type="button" className="text-button" onClick={() => void cancel()}><X size={13} /> {c.cancel}</button></>}
    {phase === 'done' && <div className="access-status ok"><Check size={13} /> {c.done}</div>}
    {phase === 'error' && err && <div className="access-status bad">{err}</div>}
    {thumbs.length > 0 && <>
      <div className="tool-label">{c.results} · {thumbs.length} · {c.sent}</div>
      <ul className="img-results">{thumbs.map((t) => <li key={t.name}><img src={t.url} alt={t.name} /><span>{t.name}</span><a href={t.url} download={t.name} aria-label={`Download ${t.name}`}><Download size={13} /></a></li>)}</ul>
    </>}
  </section>;
}
