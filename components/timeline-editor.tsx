'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Clapperboard, Download, FolderOpen, Image as ImageIcon, Lock, Music2, Mic2, Pause, Play, RectangleHorizontal, RectangleVertical, Trash2, Type, Unlock, Upload, Wand2, X } from 'lucide-react';
import { AutoEditor } from '@/components/auto-editor';
import { TRANSITIONS } from '@/lib/client/autoEdit';
import {
  BUILT_IN_FONTS, buildPayload, cancelRender, canvasFor, defaultCaption, fmtTime, layout, readDropped, renderStatus, startRender, toAssets, tokenize, uid,
  type AClip, type Asset, type AssetKind, type CaptionStyle, type RenderStatus, type Sub, type VClip,
} from '@/lib/client/timeline';

type Sel = { track: 'visual' | 'voice' | 'sub' | 'music'; id: string } | null;
type Job = { id: string; base: string; key: string };
const PREFS = 'ips-tl-prefs';

/* ---------------------------------------------------------------- media bin */
function Zone({ title, hint, icon: Icon, kind, accept, assets, onFiles, onRemove }: {
  title: string; hint: string; icon: typeof ImageIcon; kind: AssetKind; accept: string; assets: Asset[];
  onFiles: (kind: AssetKind, files: File[]) => void; onRemove: (id: string) => void;
}) {
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const mine = assets.filter((a) => a.kind === kind);
  return <div className={`tl-zone ${over ? 'over' : ''}`}
    onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
    onDrop={async (e) => { e.preventDefault(); setOver(false); onFiles(kind, await readDropped(e.dataTransfer)); }}>
    <div className="tl-zone-head"><Icon size={18} /><div><strong>{title}</strong><span>{hint}</span></div></div>
    <div className="tl-zone-btns">
      <button type="button" className="text-button" onClick={() => filesRef.current?.click()}><Upload size={13} /> Files</button>
      <button type="button" className="text-button" onClick={() => folderRef.current?.click()}><FolderOpen size={13} /> Folder</button>
    </div>
    <input ref={filesRef} type="file" accept={accept} multiple hidden onChange={(e) => { onFiles(kind, Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    <input ref={folderRef} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(e) => { onFiles(kind, Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    {mine.length === 0 ? <p className="tl-drop-note">Drop files or a whole folder here</p>
      : <ul className="tl-assets">{mine.map((a) => <li key={a.id}>{a.type === 'image' ? <img src={a.url} alt="" /> : <span className="tl-ico">{a.type === 'video' ? '▶' : '♪'}</span>}<em>{a.name}</em><small>{a.type === 'image' ? '' : `${a.duration.toFixed(1)}s`}</small>
        <button type="button" onClick={() => onRemove(a.id)} aria-label="Remove"><X size={12} /></button></li>)}</ul>}
  </div>;
}

/** object-position that centres the subject inside the visible window (CSS object-position is not a plain centre point). */
function focusPos(f: { x: number; y: number; ar: number }, canvasAr: number) {
  const vw = Math.min(1, canvasAr / f.ar), vh = Math.min(1, f.ar / canvasAr);
  const pos = (c: number, v: number) => (v >= 1 ? 50 : Math.min(100, Math.max(0, ((c - v / 2) / (1 - v)) * 100)));
  return `${pos(f.x, vw)}% ${pos(f.y, vh)}%`;
}

/* ---------------------------------------------------------------- caption helpers (preview only; the real burn-in is the .ass file) */
function previewWords(text: string, start: number, end: number, t: number) {
  const toks = tokenize(text);
  const total = toks.reduce((n, w) => n + Math.max(1, w.trim().length), 0) || 1;
  let acc = start; const spans = toks.map((w) => { const d = ((end - start) * Math.max(1, w.trim().length)) / total; const r = { w, a: acc, b: acc + d }; acc += d; return r; });
  return spans.map((s) => ({ ...s, state: t >= s.b ? 'past' : t >= s.a ? 'now' : 'next' }));
}

export interface TimelineHandle { addImages: (files: File[]) => Promise<void> }

export const TimelineEditor = forwardRef<TimelineHandle, { scripts: { label: string; text: string }[]; onNotice: (m: string) => void }>(function TimelineEditor({ scripts, onNotice }, ref) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [visuals, setVisuals] = useState<VClip[]>([]);
  const [voices, setVoices] = useState<AClip[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [musicId, setMusicId] = useState<string | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.25);
  const [masterPrompt, setMasterPrompt] = useState('');
  const [reframe, setReframe] = useState(true);
  const [portrait, setPortrait] = useState(true);
  const [hd, setHd] = useState(false);
  const [caption, setCaption] = useState<CaptionStyle>(defaultCaption);
  const [fontAsset, setFontAsset] = useState<File | null>(null);
  const [userFonts, setUserFonts] = useState<string[]>([]);
  const [watermark, setWatermark] = useState('@IPS_Edit');
  const [wmLocked, setWmLocked] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const [px, setPx] = useState(60);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [durInput, setDurInput] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'rendering' | 'done' | 'error'>('idle');
  const [upPct, setUpPct] = useState(0);
  const [rs, setRs] = useState<RenderStatus | null>(null);
  const [err, setErr] = useState('');
  const jobRef = useRef<Job | null>(null);
  const dragRef = useRef<{ track: string; id: string } | null>(null);
  const voiceEl = useRef<HTMLAudioElement>(null);
  const musicEl = useRef<HTMLAudioElement>(null);
  const videoEl = useRef<HTMLVideoElement>(null);

  // remembered style + watermark (the watermark lock survives reloads so a handle is never edited by accident)
  useEffect(() => { try { const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}'); if (p.caption) setCaption({ ...defaultCaption, ...p.caption, fontFile: null }); if (typeof p.watermark === 'string') setWatermark(p.watermark); if (p.wmLocked) setWmLocked(true); } catch { /* ignore */ } }, []);
  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify({ caption: { ...caption, fontFile: null }, watermark, wmLocked })); } catch { /* ignore */ } }, [caption, watermark, wmLocked]);

  const lay = useMemo(() => layout({ assets, visuals, voices, subs }), [assets, visuals, voices, subs]);
  const assetOf = useCallback((id: string) => assets.find((a) => a.id === id), [assets]);

  /* ---- importing */
  const addFiles = async (kind: AssetKind, files: File[]) => {
    if (!files.length) return;
    onNotice('Reading files…');
    const { assets: made, skipped } = await toAssets(files, kind);
    if (!made.length) { onNotice(skipped ? 'No supported files in that selection.' : 'Nothing to import.'); return; }
    setAssets((a) => [...a, ...made]);
    if (kind === 'visual') setVisuals((v) => [...v, ...made.map((m) => ({ id: uid(), assetId: m.id, duration: m.duration || 5, prompt: '' }))]);
    if (kind === 'voice') setVoices((v) => [...v, ...made.map((m) => ({ id: uid(), assetId: m.id }))]);
    if (kind === 'music') setMusicId((cur) => cur ?? made[0].id);
    onNotice(`${made.length} added${skipped ? ` · ${skipped} skipped` : ''}`);
  };
  const addFilesRef = useRef(addFiles); addFilesRef.current = addFiles;
  useImperativeHandle(ref, () => ({ addImages: (files: File[]) => addFilesRef.current('visual', files) }), []);
  const removeAsset = (id: string) => {
    setAssets((a) => a.filter((x) => x.id !== id)); setVisuals((v) => v.filter((c) => c.assetId !== id)); setVoices((v) => v.filter((c) => c.assetId !== id));
    setMusicId((m) => (m === id ? null : m)); setSel(null);
  };

  /* ---- subtitles come from the script, paired with the voice clips in order */
  const applyScript = (text: string) => {
    setScriptText(text);
    const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*(scene\s*\d+|\d+)\s*[.):-]\s*/i, '').trim()).filter(Boolean);
    setSubs(lines.map((l, i) => ({ id: subs[i]?.id ?? uid(), text: l })));
  };

  /* ---- exact timing */
  const setVisualDuration = (id: string, d: number) => setVisuals((v) => v.map((c) => (c.id === id ? { ...c, duration: Math.max(0.2, Math.round(d * 100) / 100) } : c)));
  const autoMatch = () => {
    if (!voices.length) { onNotice('Add voiceover files first.'); return; }
    setVisuals((v) => v.map((c, i) => { const vc = voices[i]; const d = vc ? assetOf(vc.assetId)?.duration ?? 0 : 0; return d > 0 ? { ...c, duration: Math.round(d * 100) / 100 } : c; }));
    onNotice('Every visual now matches its voiceover length.');
  };
  const selVisual = sel?.track === 'visual' ? visuals.find((c) => c.id === sel.id) : undefined;
  const selVisualIdx = selVisual ? visuals.indexOf(selVisual) : -1;
  useEffect(() => { if (selVisual) setDurInput(String(selVisual.duration)); }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- drag to reorder (HTML5 DnD) and drag the right edge to trim */
  const reorder = <T extends { id: string }>(list: T[], from: string, to: string) => {
    const a = list.findIndex((c) => c.id === from), b = list.findIndex((c) => c.id === to);
    if (a < 0 || b < 0 || a === b) return list;
    const next = list.slice(); const [m] = next.splice(a, 1); next.splice(b, 0, m); return next;
  };
  const onDropClip = (track: string, targetId: string) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d || d.track !== track) return;
    if (track === 'visual') setVisuals((v) => reorder(v, d.id, targetId));
    if (track === 'voice') setVoices((v) => reorder(v, d.id, targetId));
    if (track === 'sub') setSubs((v) => reorder(v, d.id, targetId));
  };
  const startTrim = (e: React.PointerEvent, c: VClip) => {
    e.stopPropagation(); e.preventDefault();
    const x0 = e.clientX, d0 = c.duration;
    const move = (ev: PointerEvent) => setVisualDuration(c.id, Math.round((d0 + (ev.clientX - x0) / px) * 10) / 10);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  /* ---- preview clock */
  const total = lay.total;
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setT((cur) => { const n = cur + dt; if (n >= total) { setPlaying(false); return total; } return n; });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);
  const curVisual = lay.visuals.find((c) => t >= c.start && t < c.start + c.duration) ?? lay.visuals[lay.visuals.length - 1];
  const curVoice = lay.voices.find((c) => t >= c.start && t < c.start + c.duration);
  const curSub = lay.subs.find((c) => t >= c.start && t < c.end);
  const curAsset = curVisual ? assetOf(curVisual.assetId) : undefined;
  useEffect(() => {
    const el = voiceEl.current; if (!el) return;
    const a = curVoice ? assetOf(curVoice.assetId) : undefined;
    if (!playing || !curVoice || !a) { el.pause(); return; }
    if (el.dataset.clip !== curVoice.id) { el.dataset.clip = curVoice.id; el.src = a.url; el.currentTime = Math.max(0, t - curVoice.start); }
    void el.play().catch(() => undefined);
  }, [playing, curVoice?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = musicEl.current; if (!el) return;
    const a = musicId ? assetOf(musicId) : undefined;
    el.volume = musicVolume;
    if (!playing || !a) { el.pause(); return; }
    if (el.dataset.m !== a.id) { el.dataset.m = a.id; el.src = a.url; el.loop = true; }
    void el.play().catch(() => undefined);
  }, [playing, musicId, musicVolume]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const v = videoEl.current; if (v && curVisual && curAsset?.type === 'video') { const want = Math.max(0, t - curVisual.start); if (!playing || Math.abs(v.currentTime - want) > 0.4) v.currentTime = Math.min(want, v.duration || want); if (playing) void v.play().catch(() => undefined); else v.pause(); } }, [t, playing, curVisual?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => { if (!total) return; if (!playing && t >= total - 0.05) setT(0); setPlaying((p) => !p); };

  /* ---- fonts */
  const loadFont = async (file: File | undefined) => {
    if (!file) return;
    const family = file.name.replace(/\.[^.]+$/, '');
    try { const ff = new FontFace(family, await file.arrayBuffer()); await ff.load(); document.fonts.add(ff); } catch { onNotice('This font file could not be read.'); return; }
    setFontAsset(file); setUserFonts((u) => (u.includes(family) ? u : [...u, family])); setCaption((c) => ({ ...c, font: family }));
    onNotice(`Font "${family}" loaded`);
  };
  const setCap = <K extends keyof CaptionStyle>(k: K, v: CaptionStyle[K]) => setCaption((c) => ({ ...c, [k]: v }));

  /* ---- export */
  const poll = useCallback(async (job: Job) => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      if (jobRef.current?.id !== job.id) return;
      try {
        const s = await renderStatus(job); setRs(s);
        if (s.status === 'DONE') { setPhase('done'); return; }
        if (s.status === 'FAILED' || s.status === 'CANCELLED') { setPhase('error'); setErr(s.status === 'CANCELLED' ? 'Cancelled.' : s.error || 'Render failed.'); return; }
      } catch (e) { setPhase('error'); setErr(e instanceof Error ? e.message : 'Lost contact with the render server.'); return; }
    }
  }, []);
  const doExport = async () => {
    if (!visuals.length) { onNotice('Add at least one visual clip first.'); return; }
    if (lay.voices.length && lay.total > lay.visualTotal + 0.3) onNotice(`Voiceover (${lay.total.toFixed(1)}s) is longer than the visuals (${lay.visualTotal.toFixed(1)}s): the end will be cut. Use "Match voice length".`);
    setErr(''); setRs(null); setUpPct(0); setPhase('uploading');
    try {
      const built = buildPayload({ assets, visuals, voices, subs, musicId, musicVolume, masterPrompt, reframe, portrait, hd, caption, fontAsset, watermark });
      const job = await startRender(built, setUpPct);
      jobRef.current = job; setPhase('rendering'); void poll(job);
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Export failed';
      setPhase('error'); setErr(m === 'NO_ENDPOINT' ? 'Connect your GPU / render server first (menu → Command Center → Video Engine).' : m === 'RUNPOD' ? 'Timeline export needs the Colab (or your own) render server. RunPod serverless cannot take this upload.' : m);
    }
  };
  const doCancel = async () => { const j = jobRef.current; jobRef.current = null; if (j) await cancelRender(j); setPhase('idle'); setRs(null); };

  const cv = canvasFor(portrait, hd);
  const ratio = `${cv.w} / ${cv.h}`;
  const busy = phase === 'uploading' || phase === 'rendering';
  const ticks = useMemo(() => { const step = px >= 90 ? 1 : px >= 40 ? 2 : 5; return Array.from({ length: Math.floor(total / step) + 2 }, (_, i) => i * step); }, [px, total]);
  const fonts = [...BUILT_IN_FONTS, ...userFonts];
  const capStyle: React.CSSProperties = {
    fontFamily: `"${caption.font}", "Noto Sans Khmer", sans-serif`, fontSize: `${caption.size}cqh`, color: caption.color, fontWeight: caption.bold ? 700 : 400,
    WebkitTextStroke: `${caption.outlineWidth * 0.6}px ${caption.outline}`, paintOrder: 'stroke fill',
    textShadow: [caption.shadow ? `${caption.shadow}px ${caption.shadow}px ${caption.shadow * 2}px rgba(0,0,0,.7)` : '', caption.glow ? `0 0 ${caption.glow * 2}px ${caption.glowColor}` : ''].filter(Boolean).join(',') || 'none',
    [caption.position === 'top' ? 'top' : caption.position === 'center' ? 'top' : 'bottom']: caption.position === 'center' ? '50%' : '10%',
    transform: caption.position === 'center' ? 'translateY(-50%)' : undefined,
  };

  return <section className="screen-card tl-screen">
    <div className="screen-heading"><div className="section-heading"><div className="heading-icon"><Clapperboard size={18} /></div><div className="heading-only"><span className="eyebrow">Timeline Editor</span></div></div></div>

    {/* 1 · media bin */}
    <div className="tl-bin">
      <Zone title="Video & Image" hint="clips, stills, generated scenes" icon={ImageIcon} kind="visual" accept="image/*,video/*" assets={assets} onFiles={addFiles} onRemove={removeAsset} />
      <Zone title="Voiceover" hint="TTS files / scene folders" icon={Mic2} kind="voice" accept="audio/*" assets={assets} onFiles={addFiles} onRemove={removeAsset} />
      <Zone title="Music / SFX" hint="background audio" icon={Music2} kind="music" accept="audio/*" assets={assets} onFiles={addFiles} onRemove={removeAsset} />
    </div>

    <AutoEditor assets={assets} onNotice={onNotice} onAssemble={(a) => { setVisuals(a.visuals); setVoices(a.voices); setSel(null); setT(0); setPlaying(false); }} />

    {/* 2 · preview + properties */}
    <div className="tl-main">
      <div className="tl-preview-col">
        <div className="tl-toolbar">
          <div className="tl-seg" role="group" aria-label="Format">
            <button type="button" className={!portrait ? 'on' : ''} onClick={() => setPortrait(false)}><RectangleHorizontal size={15} /> 16:9</button>
            <button type="button" className={portrait ? 'on' : ''} onClick={() => setPortrait(true)}><RectangleVertical size={15} /> 9:16</button>
          </div>
          <label className="tl-check"><input type="checkbox" checked={reframe} onChange={(e) => setReframe(e.target.checked)} /> Smart reframe (follow subject)</label>
          <label className="tl-check"><input type="checkbox" checked={hd} onChange={(e) => setHd(e.target.checked)} /> 1080p</label>
        </div>
        <div className={`tl-canvas-wrap ${portrait ? 'portrait' : 'landscape'}`}>
          <div className="tl-canvas" style={{ aspectRatio: ratio }}>
            {curAsset?.type === 'image' && <img src={curAsset.url} alt="" style={reframe && curAsset.focus ? { objectPosition: focusPos(curAsset.focus, cv.w / cv.h) } : undefined} />}
            {curAsset?.type === 'video' && <video ref={videoEl} src={curAsset.url} muted playsInline />}
            {!curAsset && <div className="tl-empty">Preview · {cv.w}×{cv.h}</div>}
            {watermark.trim() && <span className="tl-wm">{watermark}</span>}
            {curSub && <div className="tl-cap" style={capStyle}>
              {caption.anim === 'none' ? curSub.text : previewWords(curSub.text, curSub.start, curSub.end, t).map((w, i) =>
                <span key={i} className={`w-${w.state}`} style={caption.anim === 'karaoke' ? { color: w.state === 'next' ? caption.color : caption.highlight } : { opacity: w.state === 'next' ? 0 : 1, display: 'inline-block', transform: w.state === 'now' ? 'scale(1.12)' : 'none', transition: 'transform .15s' }}>{w.w}</span>)}
            </div>}
          </div>
        </div>
        <div className="tl-transport">
          <button type="button" className="primary-button" onClick={toggle} disabled={!total}>{playing ? <Pause size={14} /> : <Play size={14} fill="currentColor" />} {playing ? 'Pause' : 'Play'}</button>
          <input type="range" min={0} max={Math.max(0.1, total)} step={0.05} value={Math.min(t, total)} onChange={(e) => { setT(Number(e.target.value)); }} aria-label="Playhead" />
          <span className="tl-time">{fmtTime(t)} / {fmtTime(total)}</span>
        </div>
        <p className="access-help">Preview framing is an estimate; the export finds the subject with OpenCV (faces first, then what stands out) and follows it through video clips{reframe ? '' : '. Smart reframe is off: the export crops from the centre'}.</p>
      </div>

      <aside className="tl-props">
        <div className="tool-label">Clip properties</div>
        {!sel && <p className="access-help">Click a clip on the timeline to edit it.</p>}
        {selVisual && (() => {
          const a = assetOf(selVisual.assetId); const vc = voices[selVisualIdx]; const vd = vc ? assetOf(vc.assetId)?.duration : undefined;
          const apply = () => { const n = Number(durInput.replace(',', '.')); if (n > 0) { setVisualDuration(selVisual.id, n); onNotice(`Clip set to exactly ${n}s`); } else onNotice('Type a number of seconds.'); };
          return <div className="tl-prop-body">
            <strong className="tl-prop-name">Scene {String(selVisualIdx + 1).padStart(2, '0')} · {a?.name}</strong>
            <label className="field-label">Duration <span>seconds</span></label>
            <div className="tl-dur"><input className="studio-input" inputMode="decimal" value={durInput} onChange={(e) => setDurInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} aria-label="Duration in seconds" /><span>sec</span>
              <button type="button" className="primary-button" onClick={apply}>Save</button></div>
            {vd !== undefined && <button type="button" className="text-button" onClick={() => { setVisualDuration(selVisual.id, vd); setDurInput(String(vd)); }}>Match voice length ({vd.toFixed(2)}s)</button>}
            {selVisualIdx > 0 && <><label className="field-label">Transition in <span>how this scene enters</span></label>
              <select className="studio-input" value={selVisual.transition ?? 'cut'} onChange={(e) => setVisuals((v) => v.map((c) => (c.id === selVisual.id ? { ...c, transition: e.target.value } : c)))}>{TRANSITIONS.map((x) => <option key={x}>{x}</option>)}</select></>}
            {a?.type === 'image' ? <>
              <label className="field-label">Animation prompt <span>overrides the master prompt</span></label>
              <textarea className="studio-input" rows={2} value={selVisual.prompt} placeholder='e.g. "Pan left" · "zoom out slowly" · "static"' onChange={(e) => setVisuals((v) => v.map((c) => (c.id === selVisual.id ? { ...c, prompt: e.target.value } : c)))} />
            </> : <p className="access-help">Video clips are trimmed (or held on the last frame) to this duration.</p>}
            <button type="button" className="text-button danger" onClick={() => { setVisuals((v) => v.filter((c) => c.id !== selVisual.id)); setSel(null); }}><Trash2 size={13} /> Remove clip</button>
          </div>;
        })()}
        {sel?.track === 'voice' && (() => { const c = lay.voices.find((x) => x.id === sel.id); const a = c && assetOf(c.assetId); return c ? <div className="tl-prop-body"><strong className="tl-prop-name">{a?.name}</strong><p className="access-help">Voice length {c.duration.toFixed(2)}s · starts at {c.start.toFixed(2)}s. Voice clips keep their real length; change the visual to match.</p>
          <button type="button" className="text-button danger" onClick={() => { setVoices((v) => v.filter((x) => x.id !== c.id)); setSel(null); }}><Trash2 size={13} /> Remove</button></div> : null; })()}
        {sel?.track === 'sub' && (() => { const s = subs.find((x) => x.id === sel.id); return s ? <div className="tl-prop-body"><label className="field-label">Caption text</label>
          <textarea className="studio-input" rows={3} value={s.text} onChange={(e) => setSubs((v) => v.map((x) => (x.id === s.id ? { ...x, text: e.target.value } : x)))} />
          <button type="button" className="text-button danger" onClick={() => { setSubs((v) => v.filter((x) => x.id !== s.id)); setSel(null); }}><Trash2 size={13} /> Remove</button></div> : null; })()}
        {sel?.track === 'music' && <div className="tl-prop-body"><label className="field-label">Music volume <span>{Math.round(musicVolume * 100)}%</span></label>
          <input type="range" min={0} max={1} step={0.05} value={musicVolume} onChange={(e) => setMusicVolume(Number(e.target.value))} /></div>}
      </aside>
    </div>

    {/* 3 · timeline */}
    <div className="tl-bar">
      <div className="tool-label">Timeline · {fmtTime(total)}</div>
      <span className="tl-bar-actions"><button type="button" className="text-button" onClick={autoMatch}><Wand2 size={13} /> Match all to voice</button>
        <label className="tl-zoom">Zoom <input type="range" min={20} max={160} value={px} onChange={(e) => setPx(Number(e.target.value))} /></label></span>
    </div>
    <div className="tl-scroll">
      <div className="tl-inner" style={{ width: Math.max(total * px + 120, 320) }}>
        <div className="tl-ruler" onPointerDown={(e) => { const r = e.currentTarget.getBoundingClientRect(); setT(Math.max(0, Math.min(total, (e.clientX - r.left - 78) / px))); }}>
          {ticks.map((s) => <span key={s} style={{ left: 78 + s * px }}>{s}s</span>)}
        </div>
        <div className="tl-playhead" style={{ left: 78 + Math.min(t, total) * px }} />
        {([
          ['visual', 'Visuals', lay.visuals.map((c) => ({ id: c.id, w: c.duration, label: assetOf(c.assetId)?.name ?? '', sub: `${c.duration.toFixed(1)}s${(c as VClip).transition && (c as VClip).transition !== 'cut' ? ` ⇢${(c as VClip).transition}` : ''}`, thumb: assetOf(c.assetId), trim: c as VClip }))],
          ['voice', 'Voiceover', lay.voices.map((c) => ({ id: c.id, w: c.duration, label: assetOf(c.assetId)?.name ?? '', sub: `${c.duration.toFixed(1)}s`, thumb: undefined, trim: undefined }))],
          ['music', 'Background', musicId ? [{ id: musicId, w: Math.max(total, 1), label: assetOf(musicId)?.name ?? '', sub: 'loops', thumb: undefined, trim: undefined }] : []],
          ['sub', 'Subtitles', lay.subs.map((c) => ({ id: c.id, w: c.end - c.start, label: c.text, sub: '', thumb: undefined, trim: undefined }))],
        ] as const).map(([track, name, clips]) =>
          <div className="tl-track" key={track}><div className="tl-track-name">{name}</div>
            <div className={`tl-lane ${track}`}>{clips.length === 0 ? <span className="tl-lane-empty">—</span> : clips.map((c) =>
              <div key={c.id} className={`tl-clip ${track} ${sel?.track === track && sel.id === c.id ? 'sel' : ''}`} style={{ width: Math.max(18, c.w * px - 2) }}
                draggable={track !== 'music'} onDragStart={() => { dragRef.current = { track, id: c.id }; }} onDragOver={(e) => e.preventDefault()} onDrop={() => onDropClip(track, c.id)}
                onClick={() => setSel({ track, id: c.id })} title={c.label}>
                {c.thumb?.type === 'image' && <img src={c.thumb.url} alt="" />}<span className="tl-clip-label">{c.label}</span>{c.sub && <small>{c.sub}</small>}
                {track === 'visual' && c.trim && <i className="tl-handle" onPointerDown={(e) => startTrim(e, c.trim as VClip)} aria-label="Trim" />}
              </div>)}</div></div>)}
      </div>
    </div>
    <p className="access-help">Drag clips to reorder · drag a visual&apos;s right edge to trim, or type exact seconds in Clip properties · click the ruler to move the playhead.</p>

    {/* 4 · master prompt */}
    <div className="tl-master">
      <label className="field-label"><span style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 11 }}>Master animation prompt</span><span>applies to every image without its own prompt</span></label>
      <input className="studio-input" value={masterPrompt} placeholder='e.g. "slow cinematic zoom in for all scenes"' onChange={(e) => setMasterPrompt(e.target.value)} />
    </div>

    {/* 5 · captions */}
    <details className="tl-panel" open>
      <summary><Type size={15} /> Captions & typography</summary>
      <label className="field-label">Script lines <span>one per scene · pairs with the voiceover files in order</span></label>
      <textarea className="studio-input" rows={4} value={scriptText} placeholder="Paste or type the script, one line per scene" onChange={(e) => applyScript(e.target.value)} />
      <div className="tl-chips">{scripts.filter((s) => s.text.trim()).map((s) => <button key={s.label} type="button" className="chip" onClick={() => applyScript(s.text)}>Use {s.label} script</button>)}</div>
      <div className="tl-grid">
        <label>Font<select className="studio-input" value={caption.font} onChange={(e) => { setCap('font', e.target.value); if (!userFonts.includes(e.target.value)) setFontAsset(null); }}>{fonts.map((f) => <option key={f}>{f}</option>)}</select></label>
        <label>Upload font (.ttf / .otf)<input className="studio-input" type="file" accept=".ttf,.otf,font/ttf,font/otf" onChange={(e) => { void loadFont(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <label>Size {caption.size}%<input type="range" min={3} max={10} step={0.5} value={caption.size} onChange={(e) => setCap('size', Number(e.target.value))} /></label>
        <label>Position<select className="studio-input" value={caption.position} onChange={(e) => setCap('position', e.target.value as CaptionStyle['position'])}><option value="bottom">Bottom</option><option value="center">Center</option><option value="top">Top</option></select></label>
        <label>Text colour<input type="color" value={caption.color} onChange={(e) => setCap('color', e.target.value)} /></label>
        <label>Stroke colour<input type="color" value={caption.outline} onChange={(e) => setCap('outline', e.target.value)} /></label>
        <label>Stroke width {caption.outlineWidth}<input type="range" min={0} max={8} step={0.5} value={caption.outlineWidth} onChange={(e) => setCap('outlineWidth', Number(e.target.value))} /></label>
        <label>Drop shadow {caption.shadow}<input type="range" min={0} max={8} step={0.5} value={caption.shadow} onChange={(e) => setCap('shadow', Number(e.target.value))} /></label>
        <label>Glow {caption.glow}<input type="range" min={0} max={12} step={1} value={caption.glow} onChange={(e) => setCap('glow', Number(e.target.value))} /></label>
        <label>Glow colour<input type="color" value={caption.glowColor} onChange={(e) => setCap('glowColor', e.target.value)} /></label>
        <label>Animation<select className="studio-input" value={caption.anim} onChange={(e) => setCap('anim', e.target.value as CaptionStyle['anim'])}><option value="none">None</option><option value="pop">Word-by-word pop-up</option><option value="karaoke">Karaoke highlight</option></select></label>
        <label>Highlight colour<input type="color" value={caption.highlight} onChange={(e) => setCap('highlight', e.target.value)} /></label>
        <label className="tl-check"><input type="checkbox" checked={caption.bold} onChange={(e) => setCap('bold', e.target.checked)} /> Bold</label>
      </div>
      <p className="access-help">Word timing is spread across each voice clip by word length (the render server turns this into a .ass subtitle file and burns it in). Kantumruy Pro / Suwannaphum are fetched by the render server; an uploaded font is sent with the export.</p>
    </details>

    {/* 6 · watermark */}
    <details className="tl-panel" open>
      <summary><Lock size={15} /> Watermark</summary>
      <div className="tl-wm-row">
        <input className="studio-input" value={watermark} readOnly={wmLocked} placeholder="@IPS_Edit" onChange={(e) => setWatermark(e.target.value)} aria-label="Watermark text" />
        <button type="button" className={`toggle ${wmLocked ? 'is-on' : ''}`} onClick={() => setWmLocked((v) => !v)} aria-pressed={wmLocked} aria-label={wmLocked ? 'Unlock watermark' : 'Lock watermark'}><span /></button>
        <span className="tl-lock">{wmLocked ? <><Lock size={13} /> Locked</> : <><Unlock size={13} /> Unlocked</>}</span>
      </div>
      <p className="access-help">Placed at the top-left corner and burned into the export. Lock it so it cannot be edited by accident.</p>
    </details>

    {/* 7 · export */}
    <div className="tl-export">
      <button type="button" className="primary-button big-copy" onClick={doExport} disabled={busy || !visuals.length}><Download size={16} /> Export Video · {cv.w}×{cv.h}</button>
      {busy && <div className="tl-progress"><div className="tl-bar-track"><i style={{ width: `${phase === 'uploading' ? upPct * 0.5 : 50 + (rs?.progress ?? 0) / 2}%` }} /></div>
        <span>{phase === 'uploading' ? `Uploading to render server… ${upPct}%` : `${rs?.stage ?? 'Starting'} · ${Math.round(rs?.progress ?? 0)}%`}</span>
        <button type="button" className="text-button" onClick={doCancel}>Cancel</button></div>}
      {phase === 'done' && rs?.url && <div className="access-status ok">Done. <a href={rs.url} download target="_blank" rel="noreferrer">Download MP4</a></div>}
      {phase === 'error' && <div className="access-status bad">{err}</div>}
      <p className="access-help">Sends the timeline (clips, exact durations, animation prompts, reframe, captions, watermark) as one JSON job to your render server (Colab). Keep that Colab cell running.</p>
    </div>
    <audio ref={voiceEl} hidden /><audio ref={musicEl} hidden />
  </section>;
});
