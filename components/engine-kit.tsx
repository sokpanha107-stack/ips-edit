'use client';

/**
 * Master Engine kit: the compact reference upload + Lock bar and the control suite shared by the Video and Image engines.
 * Config (reference picture, lock, options) is saved on this device so a reload or a resumed session never changes locked inputs.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Lock, Unlock } from 'lucide-react';

export type Aspect = '9:16' | '16:9' | '1:1';
export interface EngineOpts { aspect: Aspect; similarity: number; fast: boolean; seed: string }
export interface RefImage { name: string; url: string }   // url is a (downscaled) data URL, so it survives reloads
export const DEFAULT_OPTS: EngineOpts = { aspect: '9:16', similarity: 0.6, fast: false, seed: '' };
export const RATIO: Record<Aspect, number> = { '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1 };

const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = src; });

/** Downscales a picture to <=1280px JPEG so it can be stored and uploaded cheaply. */
export async function fileToRef(file: File): Promise<RefImage> {
  const src = URL.createObjectURL(file);
  try {
    const img = await load(src);
    const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return { name: file.name, url: c.toDataURL('image/jpeg', 0.88) };
  } finally { URL.revokeObjectURL(src); }
}

/** Center-crops the picture to the chosen aspect ratio (the video worker follows the picture's own proportions). */
export async function cropToAspect(dataUrl: string, aspect: Aspect): Promise<string> {
  const img = await load(dataUrl);
  const target = RATIO[aspect], cur = img.naturalWidth / img.naturalHeight;
  if (Math.abs(cur - target) < 0.01) return dataUrl;
  let sw = img.naturalWidth, sh = img.naturalHeight;
  if (cur > target) sw = Math.round(sh * target); else sh = Math.round(sw / target);
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  c.getContext('2d')!.drawImage(img, Math.round((img.naturalWidth - sw) / 2), Math.round((img.naturalHeight - sh) / 2), sw, sh, 0, 0, sw, sh);
  return c.toDataURL('image/jpeg', 0.92);
}
export const dataUrlToFile = async (u: string, name: string) => new File([await (await fetch(u)).blob()], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });

/** The saved reference picture, read straight from storage (usable before React has loaded the config, e.g. on auto-resume). */
export function readSavedRef(engine: 'video' | 'image'): RefImage | null {
  try { return (JSON.parse(localStorage.getItem(`ips-cfg-${engine}`) || 'null') as { ref?: RefImage | null } | null)?.ref ?? null; } catch { return null; }
}

interface Saved { ref: RefImage | null; locked: boolean; opts: EngineOpts }

/** Reference picture + Lock + options for one engine, persisted per engine. While locked every setter is a no-op. */
export function useEngineConfig(engine: 'video' | 'image') {
  const key = `ips-cfg-${engine}`;
  const [ref, setRefState] = useState<RefImage | null>(null);
  const [locked, setLocked] = useState(false);
  const [opts, setOptsState] = useState<EngineOpts>(DEFAULT_OPTS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(key) || 'null') as Partial<Saved> | null; if (s) { setRefState(s.ref ?? null); setLocked(!!s.locked); setOptsState({ ...DEFAULT_OPTS, ...(s.opts ?? {}) }); } } catch { /* ignore */ }
    setLoaded(true);
  }, [key]);
  useEffect(() => { if (!loaded) return; try { localStorage.setItem(key, JSON.stringify({ ref, locked, opts } satisfies Saved)); } catch { /* quota: keep working without saving */ } }, [key, loaded, ref, locked, opts]);
  const setRef = useCallback(async (f: File) => { if (locked) return; setRefState(await fileToRef(f)); }, [locked]);
  const setOpts = useCallback((p: Partial<EngineOpts>) => { if (!locked) setOptsState((o) => ({ ...o, ...p })); }, [locked]);
  return { ref, locked, opts, setRef, setOpts, toggleLock: () => setLocked((v) => !v), clearRef: () => { if (!locked) setRefState(null); } };
}

function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange} className={`relative h-6 w-11 flex-none rounded-full border border-[var(--line)] transition-colors ${on ? 'bg-[var(--amber)]' : 'bg-[color-mix(in_srgb,var(--ink)_14%,transparent)]'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} /></button>;
}

/** Compact top bar: icon-only upload (no text), true-aspect preview, Lock switch on the right. */
export function RefBar({ cfg, onNotice }: { cfg: ReturnType<typeof useEngineConfig>; onNotice: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [ratio, setRatio] = useState(0);
  const accept = (f?: File | null) => {
    if (!f || cfg.locked) return;
    if (!f.type.startsWith('image/') || f.size > 25 * 1024 * 1024) { onNotice('Use an image file under 25 MB.'); return; }
    void cfg.setRef(f).catch(() => onNotice('Could not read that image.'));
  };
  return <div className="flex items-center gap-3">
    <button type="button" aria-label="Reference image" disabled={cfg.locked} onClick={() => input.current?.click()}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); accept(e.dataTransfer.files[0]); }}
      className="grid min-h-14 min-w-14 place-items-center overflow-hidden rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-[var(--ink-soft)] disabled:cursor-not-allowed"
      style={cfg.ref && ratio ? { aspectRatio: String(ratio), height: ratio < 1 ? 168 : ratio > 1.2 ? 84 : 120 } : { width: 56, height: 56 }}>
      {cfg.ref ? <img src={cfg.ref.url} alt="" className="h-full w-full object-contain" onLoad={(e) => setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} /> : <ImagePlus size={22} />}
    </button>
    <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { accept(e.target.files?.[0]); e.target.value = ''; }} />
    <span className="ml-auto flex items-center gap-2 text-[var(--ink-soft)]">{cfg.locked ? <Lock size={15} /> : <Unlock size={15} />}<Switch on={cfg.locked} onChange={cfg.toggleLock} label="Lock" /></span>
  </div>;
}

const L = {
  en: { aspect: 'Aspect ratio', similar: 'Signature similarity', quality: 'Quality', fast: 'Fast', normal: 'Normal', seed: 'Seed (optional)' },
  kh: { aspect: 'ទម្រង់ (Aspect ratio)', similar: 'ភាពដូច Signature', quality: 'គុណភាព', fast: 'លឿន', normal: 'ធម្មតា', seed: 'Seed (ជម្រើស)' },
} as const;

/** Aspect, similarity, quality, seed. Frozen while the Lock is on or a job is running. */
export function OptionsPanel({ language, opts, onChange, disabled }: { language: 'en' | 'kh'; opts: EngineOpts; onChange: (p: Partial<EngineOpts>) => void; disabled?: boolean }) {
  const c = L[language];
  return <div className="grid gap-3 sm:grid-cols-2">
    <div><span className="field-label">{c.aspect}</span>
      <div className="voice-switch" role="radiogroup" style={{ width: 'fit-content' }}>{(['9:16', '16:9', '1:1'] as Aspect[]).map((a) => <button key={a} type="button" role="radio" aria-checked={opts.aspect === a} disabled={disabled} className={opts.aspect === a ? 'active' : ''} onClick={() => onChange({ aspect: a })}>{a}</button>)}</div></div>
    <label className="field-label">{c.similar} · {Math.round(opts.similarity * 100)}%<input type="range" min={0} max={100} step={5} value={Math.round(opts.similarity * 100)} disabled={disabled} onChange={(e) => onChange({ similarity: Number(e.target.value) / 100 })} className="mt-2 block w-full" /></label>
    <label className="field-label">{c.quality}<select className="studio-input" value={opts.fast ? 'fast' : 'normal'} disabled={disabled} onChange={(e) => onChange({ fast: e.target.value === 'fast' })}><option value="normal">{c.normal}</option><option value="fast">{c.fast}</option></select></label>
    <label className="field-label">{c.seed}<input className="studio-input" inputMode="numeric" value={opts.seed} disabled={disabled} onChange={(e) => onChange({ seed: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></label>
  </div>;
}
