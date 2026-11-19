/** Audio-driven Master Script Auto-Editor: exact audio durations + strict script parser + timeline builder. */
import type { Asset, VClip, AClip } from './timeline';
import { uid } from './timeline';

/** Exact length in seconds. Web Audio decoding gives the true sample count (HTMLAudioElement can be off for VBR mp3); falls back to element metadata. */
export async function audioDuration(file: File | Blob, url?: string): Promise<number> {
  try {
    const Ctx = (window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext);
    if (Ctx) {
      const ctx = new Ctx(1, 1, 44100);
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      if (buf.duration > 0) return Math.round(buf.duration * 1000) / 1000;
    }
  } catch { /* some formats cannot be decoded: use the element below */ }
  return new Promise((resolve) => {
    const el = document.createElement('audio');
    const own = !url; const src = url ?? URL.createObjectURL(file);
    el.preload = 'metadata';
    const done = (v: number) => { el.removeAttribute('src'); if (own) URL.revokeObjectURL(src); resolve(Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0); };
    el.onloadedmetadata = () => done(el.duration); el.onerror = () => done(0); el.src = src;
  });
}

export const MOTIONS = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'pan_up', 'pan_down', 'static'] as const;
export const TRANSITIONS = ['cut', 'fade', 'dissolve', 'fadeblack', 'wipe_left', 'wipe_right', 'slide_left', 'slide_right', 'zoom'] as const;
export const CAMERAS = ['none', 'handheld_breath', 'impact_shake', 'smooth_glide'] as const;
export const OVERLAYS = ['none', 'dust_particles', 'light_leak', 'rain', 'film_grain', 'vignette'] as const;
export const SFXS = ['none', 'whoosh', 'riser', 'bass_hit', 'subtle_chime'] as const;
export type SubMode = 'line' | 'block';

/** Every lookup key is lower-cased with all spaces, "-" and "_" removed, so "Zoom In", "zoom_in" and "ZOOM-IN" are the same word. */
const squash = (v: string) => v.trim().replace(/^\[|\]$/g, '').trim().toLowerCase().replace(/[^a-z0-9.]+/g, '');
const mapOf = (list: readonly string[], extra: Record<string, string> = {}) => {
  const m: Record<string, string> = {}; list.forEach((x) => { m[squash(x)] = x; }); Object.entries(extra).forEach(([k, v]) => { m[squash(k)] = v; }); return m;
};
const MOTION_MAP = mapOf(MOTIONS, { none: 'static', still: 'static', 'zoom in': 'zoom_in', 'zoom out': 'zoom_out', 'pan left': 'pan_left', 'pan right': 'pan_right', 'pan up': 'pan_up', 'pan down': 'pan_down' });
const TRANS_MAP = mapOf(TRANSITIONS, { none: 'cut', crossfade: 'dissolve', 'cross fade': 'dissolve', 'cross dissolve': 'dissolve', 'fade black': 'fadeblack', 'fade to black': 'fadeblack', 'dip to black': 'fadeblack', 'zoom in': 'zoom' });
const CAMERA_MAP = mapOf(CAMERAS, { off: 'none', breath: 'handheld_breath', handheld: 'handheld_breath', shake: 'impact_shake', impact: 'impact_shake', glide: 'smooth_glide', smooth: 'smooth_glide' });
const OVERLAY_MAP = mapOf(OVERLAYS, { off: 'none', dust: 'dust_particles', particles: 'dust_particles', leak: 'light_leak', grain: 'film_grain' });
const SFX_MAP = mapOf(SFXS, { off: 'none', chime: 'subtle_chime', hit: 'bass_hit', bass: 'bass_hit' });
const KEY_MAP: Record<string, 'image' | 'motion' | 'transition' | 'depth' | 'camera' | 'overlay' | 'callout' | 'sfx' | 'subtitle'> = {
  image: 'image', img: 'image', file: 'image', motion: 'motion', move: 'motion', transition: 'transition', depth: 'depth', parallax: 'depth', camera: 'camera', overlay: 'overlay', callout: 'callout', sfx: 'sfx', sound: 'sfx', subtitle: 'subtitle', subtitles: 'subtitle', caption: 'subtitle',
};

/** Accepted shape (only Scene + Image are required; the rest are optional and may come in any order):
 *  [Scene X] | Image: filename.jpg | Motion: ... | Transition: ... | Depth: ... | Camera: ... | Overlay: ... | Callout: "..." | SFX: ... | Subtitle: ... */
export const FORMAT_FULL = '[Scene X] | Image: filename.jpg | Motion: ... | Transition: ... | Depth: on/off | Camera: ... | Overlay: ... | Callout: "text" | SFX: ... | Subtitle: ...';
export const SCENE_TAG = /^\s*\[?\s*scene\s*[_ -]?(\d+)\s*\]?\s*$/i;

export interface SceneSpec {
  line: number; n: number; image: string; motion: string; transition: string;
  depth?: boolean; camera?: string; overlay?: string; callout?: string; sfx?: string; subtitle?: SubMode;
}
export interface ParseIssue { line: number; text: string; reason: string }

/** Splits on "|" but keeps a "|" that sits inside quotes (callout text). */
export function splitFields(t: string): string[] {
  const out: string[] = []; let cur = '', q = '';
  for (const ch of t) {
    if (q) { if (ch === q) q = ''; cur += ch; } else if (ch === '"' || ch === '“' || ch === '”') { q = ch === '“' ? '”' : ch; cur += ch; } else if (ch === '|') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out.map((x) => x.trim());
}
const unquote = (v: string) => v.trim().replace(/^["“”']+|["“”']+$/g, '').trim();

function parseDepth(v: string): boolean | undefined {
  const k = squash(v);
  if (['on', 'true', 'yes', '1', '2.5d', '2.5dparallax', 'parallax'].includes(k)) return true;
  if (['off', 'false', 'no', '0', 'none'].includes(k)) return false;
  return undefined;
}
function parseSub(v: string): SubMode | undefined {
  const k = squash(v);
  if (k.startsWith('1line') || k.startsWith('oneline') || k.startsWith('line') || k.startsWith('wordbyword')) return 'line';
  if (k.startsWith('fullblock') || k.startsWith('block') || k.startsWith('full')) return 'block';
  return undefined;
}

export function parseMasterScript(text: string): { scenes: SceneSpec[]; issues: ParseIssue[] } {
  const scenes: SceneSpec[] = [], issues: ParseIssue[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) return;
    const bad = (reason: string) => { issues.push({ line: i + 1, text: t, reason }); };
    const parts = splitFields(t);
    const tag = SCENE_TAG.exec(parts[0]);
    if (!tag) return bad('Line must start with [Scene X] and use " | " between fields. ' + FORMAT_FULL);
    const n = Number(tag[1]);
    const f: Partial<Record<string, string>> = {};
    for (const part of parts.slice(1)) {
      if (!part) continue;
      const c = part.indexOf(':');
      if (c < 1) return bad(`Cannot read "${part}". Write each field as Name: value.`);
      const key = KEY_MAP[squash(part.slice(0, c))];
      if (!key) return bad(`Unknown field "${part.slice(0, c).trim()}". Use: Image, Motion, Transition, Depth, Camera, Overlay, Callout, SFX, Subtitle.`);
      f[key] = part.slice(c + 1).trim();
    }
    if (!f.image) return bad('Missing "Image: filename".');
    const motion = f.motion === undefined ? 'static' : MOTION_MAP[squash(f.motion)];
    if (!motion) return bad(`Unknown motion "${f.motion}". Use: ${MOTIONS.join(', ')}`);
    const transition = f.transition === undefined ? 'cut' : TRANS_MAP[squash(f.transition)];
    if (!transition) return bad(`Unknown transition "${f.transition}". Use: ${TRANSITIONS.join(', ')}`);
    const sc: SceneSpec = { line: i + 1, n, image: unquote(f.image), motion, transition };
    if (f.depth !== undefined) { const d = parseDepth(f.depth); if (d === undefined) return bad(`Depth must be on or off (got "${f.depth}").`); sc.depth = d; }
    if (f.camera !== undefined) { const v = CAMERA_MAP[squash(f.camera)]; if (!v) return bad(`Unknown camera "${f.camera}". Use: ${CAMERAS.join(', ')}`); sc.camera = v; }
    if (f.overlay !== undefined) { const v = OVERLAY_MAP[squash(f.overlay)]; if (!v) return bad(`Unknown overlay "${f.overlay}". Use: ${OVERLAYS.join(', ')}`); sc.overlay = v; }
    if (f.sfx !== undefined) { const v = SFX_MAP[squash(f.sfx)]; if (!v) return bad(`Unknown SFX "${f.sfx}". Use: ${SFXS.join(', ')}`); sc.sfx = v; }
    if (f.subtitle !== undefined) { const v = parseSub(f.subtitle); if (!v) return bad('Subtitle must start with "1-Line" or "Full Block".'); sc.subtitle = v; }
    if (f.callout !== undefined && unquote(f.callout)) sc.callout = unquote(f.callout);
    if (scenes.some((x) => x.n === n)) return bad(`Scene ${n} appears twice`);
    scenes.push(sc);
  });
  return { scenes, issues };
}

const base = (n: string) => n.toLowerCase().replace(/\.[a-z0-9]+$/, '');
export function findImage(assets: Asset[], name: string): Asset | undefined {
  const v = assets.filter((a) => a.kind === 'visual'), low = name.toLowerCase();
  return v.find((a) => a.name.toLowerCase() === low) ?? v.find((a) => (a.file.webkitRelativePath || '').toLowerCase().endsWith(`/${low}`)) ?? v.find((a) => base(a.name) === base(name));
}
/** Scene 3 -> the audio whose file name contains the number 3 (scene_03.mp3, 3.wav…). If none do but the counts match, the order decides. */
export function findAudio(voices: Asset[], n: number, index: number, sceneCount: number): Asset | undefined {
  const byNumber = voices.find((a) => (base(a.name).match(/\d+/g) ?? []).some((d) => Number(d) === n));
  if (byNumber) return byNumber;
  return voices.length === sceneCount ? voices[index] : undefined;
}

export interface Assembly { visuals: VClip[]; voices: AClip[]; warnings: string[]; errors: string[] }

/** Builds the timeline: one visual clip per scene whose length is exactly its audio's length, with the parsed motion and transition. */
export function assemble(scenes: SceneSpec[], assets: Asset[], transitionLen = 0.5): Assembly {
  const voices = assets.filter((a) => a.kind === 'voice');
  const out: Assembly = { visuals: [], voices: [], warnings: [], errors: [] };
  scenes.forEach((s, i) => {
    const img = findImage(assets, s.image);
    if (!img) { out.errors.push(`Scene ${s.n}: image "${s.image}" is not in the media bin.`); return; }
    const au = findAudio(voices, s.n, i, scenes.length);
    let dur = au?.duration ?? 0;
    if (!au) out.warnings.push(`Scene ${s.n}: no audio file found, using 5 s.`);
    else if (dur <= 0) out.warnings.push(`Scene ${s.n}: could not read the length of "${au.name}", using 5 s.`);
    if (dur <= 0) dur = 5;
    out.visuals.push({ id: uid(), assetId: img.id, duration: dur, prompt: s.motion.replace(/_/g, ' '), motion: s.motion, transition: i === 0 ? 'cut' : s.transition, transitionDur: transitionLen, depth: s.depth, camera: s.camera, overlay: s.overlay, callout: s.callout, sfx: s.sfx, subMode: s.subtitle });
    if (au) out.voices.push({ id: uid(), assetId: au.id });
  });
  return out;
}
