/** Pure logic for the Timeline Editor: media import, timeline math, caption words, export payload and upload. */
import { getVideoEndpoint } from './api';
import { audioDuration } from './autoEdit';

export type AssetKind = 'visual' | 'voice' | 'music';
export interface Asset { id: string; kind: AssetKind; type: 'image' | 'video' | 'audio'; file: File; url: string; name: string; duration: number; focus?: { x: number; y: number; ar: number } }
export interface VClip {
  id: string; assetId: string; duration: number; prompt: string; transition?: string; transitionDur?: number;
  /** Per-scene motion-graphic overrides from the Master Script. undefined = use the global setting. */
  motion?: string; depth?: boolean; camera?: string; overlay?: string; callout?: string; sfx?: string; subMode?: 'line' | 'block';
}
/**
 * Floating "ghost" watermark. ONE definition shared by the live preview and the render server (render_api.py uses the same numbers):
 * size 2.5% of the shorter side, white @ 28% with a 1px black @ 35% shadow, bouncing diagonally (triangle waves) at vx 55 / vy 42 px/s
 * measured on a 720px short side and scaled with the resolution.
 */
export const WM = { sizePct: 2.5, opacity: 0.28, shadowOpacity: 0.35, vx: 55, vy: 42, marginPct: 3.5 } as const;
/** Top-left position (output pixels) of a text box tw x th at time t. Triangle wave: 0 -> range -> 0, never a short loop because vx and vy differ. */
export function wmPosition(t: number, W: number, H: number, tw: number, th: number): { x: number; y: number } {
  const short = Math.min(W, H), k = short / 720, m = short * WM.marginPct / 100;
  const rx = Math.max(1, W - tw - 2 * m), ry = Math.max(1, H - th - 2 * m);
  const tri = (u: number, r: number) => r - Math.abs((((u % (2 * r)) + 2 * r) % (2 * r)) - r);
  return { x: m + tri(WM.vx * k * t + 0.12 * rx, rx), y: m + tri(WM.vy * k * t + 0.33 * ry, ry) };
}
export const wmFontPx = (W: number, H: number) => Math.round(Math.min(W, H) * WM.sizePct / 100);

/** Global Top Motion Graphic settings (per-scene tags override them). */
export interface FxSettings { depth: boolean; camera: string; overlay: string; autoSfx: boolean; autoDuck: boolean; /** 'style' = follow the Caption style animation (default) */ subMode: 'style' | 'line' | 'block' }
export const defaultFx: FxSettings = { depth: false, camera: 'none', overlay: 'none', autoSfx: false, autoDuck: true, subMode: 'style' };
/** Auto-SFX: the sound that fits how a scene enters. The first scene has no entry sound. */
export const autoSfxFor = (transition: string | undefined): string => {
  const t = transition ?? 'cut';
  if (t === 'cut') return 'bass_hit';
  if (t.startsWith('wipe') || t.startsWith('slide')) return 'whoosh';
  if (t === 'zoom') return 'riser';
  return 'subtle_chime';
};
export interface AClip { id: string; assetId: string }
export interface Sub { id: string; text: string }

export interface CaptionStyle {
  font: string; fontFile: string | null; size: number; color: string; outline: string; outlineWidth: number; shadow: number;
  glow: number; glowColor: string; anim: 'none' | 'pop' | 'karaoke'; highlight: string; position: 'bottom' | 'center' | 'top'; bold: boolean;
}
export const defaultCaption: CaptionStyle = {
  font: 'Kantumruy Pro', fontFile: null, size: 5.5, color: '#ffffff', outline: '#000000', outlineWidth: 3, shadow: 1,
  glow: 0, glowColor: '#ffd400', anim: 'pop', highlight: '#ffd400', position: 'bottom', bold: true,
};
export const BUILT_IN_FONTS = ['Kantumruy Pro', 'Suwannaphum', 'Noto Sans Khmer', 'Inter'];

export const canvasFor = (portrait: boolean, hd: boolean) => {
  const short = hd ? 1080 : 720, long = hd ? 1920 : 1280;
  return portrait ? { w: short, h: long, fps: 30 } : { w: long, h: short, fps: 30 };
};

const IMG = /\.(png|jpe?g|webp|gif|bmp|avif|heic)$/i, VID = /\.(mp4|mov|m4v|webm|mkv)$/i, AUD = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;
export const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
export const uid = () => Math.random().toString(36).slice(2, 10);
export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;

/** Files dropped on a zone: walks whole folders (webkitGetAsEntry) so a dragged scene folder arrives complete. */
export async function readDropped(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) { out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))); return; }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e);
    }
  };
  const entries = Array.from(dt.items ?? []).map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length) { for (const e of entries) await walk(e); return out; }
  return Array.from(dt.files);
}

function mediaDuration(url: string, tag: 'audio' | 'video'): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(tag);
    el.preload = 'metadata';
    const done = (v: number) => { el.removeAttribute('src'); resolve(Number.isFinite(v) ? v : 0); };
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(0);
    el.src = url;
  });
}

/** Rough 'where is the subject' guess for the preview only: the area that differs most from the picture's average colour. The export uses OpenCV on the server. */
export function estimateSubject(url: string): Promise<{ x: number; y: number; ar: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ar = img.naturalWidth / Math.max(1, img.naturalHeight);
      try {
        const n = 48, c = document.createElement('canvas'); c.width = n; c.height = n;
        const g = c.getContext('2d'); if (!g) return resolve({ x: 0.5, y: 0.5, ar });
        g.drawImage(img, 0, 0, n, n);
        const d = g.getImageData(0, 0, n, n).data;
        let r = 0, gg = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
        const m = [r, gg, b].map((v) => v / (n * n));
        const score: number[] = [];
        for (let i = 0; i < d.length; i += 4) score.push(Math.abs(d[i] - m[0]) + Math.abs(d[i + 1] - m[1]) + Math.abs(d[i + 2] - m[2]));
        const thr = [...score].sort((a, b2) => a - b2)[Math.floor(score.length * 0.85)];
        let sw = 0, sx = 0, sy = 0;
        score.forEach((v, i) => { if (v > thr) { sw += v; sx += v * (i % n); sy += v * Math.floor(i / n); } });
        resolve(sw ? { x: sx / sw / n, y: sy / sw / n, ar } : { x: 0.5, y: 0.5, ar });
      } catch { resolve({ x: 0.5, y: 0.5, ar }); }
    };
    img.onerror = () => resolve({ x: 0.5, y: 0.5, ar: 1 });
    img.src = url;
  });
}

/** Turns picked/dropped files into assets for one zone. Unsupported files are skipped and counted. */
export async function toAssets(files: File[], zone: AssetKind): Promise<{ assets: Asset[]; skipped: number }> {
  const sorted = files.filter((f) => !f.name.startsWith('.')).sort((a, b) => natural(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
  const assets: Asset[] = [];
  let skipped = 0;
  for (const file of sorted) {
    const isImg = file.type.startsWith('image/') || IMG.test(file.name), isVid = file.type.startsWith('video/') || VID.test(file.name), isAud = file.type.startsWith('audio/') || AUD.test(file.name);
    const type = zone === 'visual' ? (isImg ? 'image' : isVid ? 'video' : null) : isAud ? 'audio' : null;
    if (!type) { skipped += 1; continue; }
    const url = URL.createObjectURL(file);
    const duration = type === 'image' ? 5 : type === 'audio' ? await audioDuration(file, url) : await mediaDuration(url, 'video');
    assets.push({ id: uid(), kind: zone, type, file, url, name: file.name, duration: Math.round(duration * 100) / 100, ...(type === 'image' ? { focus: await estimateSubject(url) } : {}) });
  }
  return { assets, skipped };
}

/** Words for caption animation. Khmer has no spaces, so the browser's dictionary segmenter is used (falls back to 3-letter chunks). */
export function tokenize(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  try {
    const seg = new Intl.Segmenter(/[ក-៿]/.test(t) ? 'km' : 'en', { granularity: 'word' });
    const out: string[] = [];
    for (const s of Array.from(seg.segment(t))) {
      if (!s.isWordLike && out.length) out[out.length - 1] += s.segment; else out.push(s.segment);
    }
    return out.filter((x) => x.length);
  } catch {
    return t.split(/(?<=\s)/u).flatMap((w) => (/[ក-៿]/.test(w) ? (w.match(/.{1,3}/gu) ?? [w]) : [w]));
  }
}

export interface TimelineState {
  assets: Asset[]; visuals: VClip[]; voices: AClip[]; subs: Sub[]; musicId: string | null; musicVolume: number;
  masterPrompt: string; reframe: boolean; portrait: boolean; hd: boolean; caption: CaptionStyle; fontAsset: File | null; watermark: string; wmOn?: boolean; fx?: FxSettings;
}

export function layout(s: Pick<TimelineState, 'assets' | 'visuals' | 'voices' | 'subs'>) {
  const dur = (id: string) => s.assets.find((a) => a.id === id)?.duration ?? 0;
  let t = 0;
  const visuals = s.visuals.map((c) => { const r = { ...c, start: t }; t += c.duration; return r; });
  const total = t;
  let a = 0;
  const voices = s.voices.map((c) => { const d = dur(c.assetId); const r = { ...c, start: a, duration: d }; a += d; return r; });
  const subs = s.subs.map((c, i) => ({ ...c, start: voices[i]?.start ?? 0, end: voices[i] ? voices[i].start + voices[i].duration : 0 })).filter((c) => c.end > c.start);
  return { visuals, voices, subs, total: Math.max(total, a), visualTotal: total };
}

export function buildPayload(s: TimelineState) {
  const lay = layout(s);
  const asset = (id: string) => s.assets.find((a) => a.id === id)!;
  const files: Record<string, File> = {};
  const keyOf = new Map<string, string>();
  const key = (prefix: string, id: string, file: File) => { if (!keyOf.has(id)) { const k = `${prefix}${keyOf.size}`; keyOf.set(id, k); files[k] = file; } return keyOf.get(id)!; };
  const fx = s.fx ?? defaultFx;
  const eff = lay.visuals.map((c, i) => {
    const camera = c.camera ?? fx.camera, overlay = c.overlay ?? fx.overlay;
    const sfx = c.sfx ?? (fx.autoSfx && i > 0 ? autoSfxFor(c.transition) : 'none');
    return { depth: c.depth ?? fx.depth, camera, overlay, callout: c.callout ?? null, sfx: sfx === 'none' ? null : sfx, subtitleMode: c.subMode ?? fx.subMode };
  });
  const payload = {
    canvas: canvasFor(s.portrait, s.hd), reframe: s.reframe, masterPrompt: s.masterPrompt.trim(),
    visuals: lay.visuals.map((c, i) => ({ file: key('v', c.assetId, asset(c.assetId).file), kind: asset(c.assetId).type, duration: c.duration, prompt: c.prompt.trim(), transition: c.transition ?? 'cut', transitionDur: c.transitionDur ?? 0.5, motion: c.motion ?? (c.prompt.trim().replace(/\s+/g, '_') || 'static'), start: c.start, fx: eff[i] })),
    voices: lay.voices.map((c) => ({ file: key('a', c.assetId, asset(c.assetId).file), start: c.start, duration: c.duration })),
    music: s.musicId ? { file: key('m', s.musicId, asset(s.musicId).file), volume: s.musicVolume, duck: fx.autoDuck } : null,
    subtitles: lay.subs.map((c, i) => ({ start: c.start, end: c.end, text: c.text, words: tokenize(c.text), mode: eff[i]?.subtitleMode ?? fx.subMode })),
    motionGraphics: {
      easing: 'exponential_out',
      depth: { enabled: eff.some((e) => e.depth), model: 'depth-anything', defaultOn: fx.depth },
      camera: fx.camera, overlay: fx.overlay, subtitleMode: fx.subMode,
      autoSfx: fx.autoSfx,
      ducking: { enabled: fx.autoDuck && !!s.musicId, musicLevel: 0.15, attackMs: 120, releaseMs: 600 },
    },
    caption: { ...s.caption, fontFile: s.fontAsset ? 'font0' : null },
    // Anti-theft ghost watermark. OFF => empty text so any worker hides it. The motion constants are mirrored in worker/render/render_api.py.
    watermark: (s.wmOn ?? true) && s.watermark.trim()
      ? { text: s.watermark.trim(), enabled: true, style: 'ghost', ...WM }
      : { text: '', enabled: false },
  };
  if (s.fontAsset) files.font0 = s.fontAsset;
  return { payload, files, total: lay.visualTotal };
}

export interface RenderStatus { status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'; progress: number; stage: string; error?: string | null; url?: string | null }

const baseOf = (u: string) => u.trim().replace(/\/+$/, '');
const headersOf = (key: string): Record<string, string> => (key ? { Authorization: `Bearer ${key}` } : {});

/** Uploads straight from the browser to the GPU/render server (big files cannot go through Vercel). Reports upload % then render %. */
export function startRender(p: { payload: unknown; files: Record<string, File> }, onUpload: (pct: number) => void): Promise<{ id: string; base: string; key: string }> {
  const ep = getVideoEndpoint();
  return new Promise((resolve, reject) => {
    if (!ep.url) return reject(new Error('NO_ENDPOINT'));
    if (/runpod\.ai/i.test(ep.url)) return reject(new Error('RUNPOD'));
    const base = baseOf(ep.url).replace(/\/(run|runsync)$/, '');
    const form = new FormData();
    form.append('payload', JSON.stringify(p.payload));
    for (const [k, f] of Object.entries(p.files)) form.append(k, f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base}/render`);
    for (const [k, v] of Object.entries(headersOf(ep.key))) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onUpload(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new Error('Cannot reach the render server. Is the RunPod Pod running and the URL current?'));
    xhr.onload = () => {
      let data: { ok?: boolean; id?: string; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status === 401) return reject(new Error('Wrong API key for the render server.'));
      if (xhr.status >= 200 && xhr.status < 300 && data.id) resolve({ id: data.id, base, key: ep.key });
      else reject(new Error(data.error || `Render server answered ${xhr.status}`));
    };
    xhr.send(form);
  });
}

export async function renderStatus(job: { id: string; base: string; key: string }): Promise<RenderStatus> {
  const res = await fetch(`${job.base}/render/status/${job.id}`, { headers: headersOf(job.key), cache: 'no-store' });
  const d = await res.json();
  if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`);
  const url: string | null = d.url ? (/^https?:/.test(d.url) ? d.url : `${job.base}${d.url}`) : null;
  return { status: d.status, progress: d.progress ?? 0, stage: d.stage ?? '', error: d.error, url };
}

export async function cancelRender(job: { id: string; base: string; key: string }) {
  try { await fetch(`${job.base}/render/cancel/${job.id}`, { method: 'POST', headers: headersOf(job.key) }); } catch { /* best effort */ }
}
