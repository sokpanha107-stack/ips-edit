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
const MOTION_ALIAS: Record<string, string> = { none: 'static', still: 'static', zoomin: 'zoom_in', zoomout: 'zoom_out', panleft: 'pan_left', panright: 'pan_right', panup: 'pan_up', pandown: 'pan_down' };
const TRANS_ALIAS: Record<string, string> = { none: 'cut', crossfade: 'fade', cross_fade: 'fade', cross_dissolve: 'dissolve', fade_black: 'fadeblack', dip_to_black: 'fadeblack', wipeleft: 'wipe_left', wiperight: 'wipe_right', slideleft: 'slide_left', slideright: 'slide_right', zoom_in: 'zoom', zoomin: 'zoom' };
const norm = (v: string) => v.trim().replace(/^\[|\]$/g, '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** The one accepted line shape:  [Scene X] | Image: filename.jpg | Motion: [Motion_Type] | Transition: [Transition_Type] */
export const LINE = /^\s*\[\s*Scene\s+(\d+)\s*\]\s*\|\s*Image\s*:\s*(.+?)\s*\|\s*Motion\s*:\s*(.+?)\s*\|\s*Transition\s*:\s*(.+?)\s*$/i;

export interface SceneSpec { line: number; n: number; image: string; motion: string; transition: string }
export interface ParseIssue { line: number; text: string; reason: string }

export function parseMasterScript(text: string): { scenes: SceneSpec[]; issues: ParseIssue[] } {
  const scenes: SceneSpec[] = [], issues: ParseIssue[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) return;
    const m = LINE.exec(t);
    if (!m) { issues.push({ line: i + 1, text: t, reason: 'Does not match: [Scene X] | Image: file.jpg | Motion: type | Transition: type' }); return; }
    const motion = MOTION_ALIAS[norm(m[3])] ?? norm(m[3]);
    const transition = TRANS_ALIAS[norm(m[4])] ?? norm(m[4]);
    const image = m[2].trim().replace(/^\[|\]$/g, '').trim();
    if (!(MOTIONS as readonly string[]).includes(motion)) { issues.push({ line: i + 1, text: t, reason: `Unknown motion "${m[3].trim()}". Use: ${MOTIONS.join(', ')}` }); return; }
    if (!(TRANSITIONS as readonly string[]).includes(transition)) { issues.push({ line: i + 1, text: t, reason: `Unknown transition "${m[4].trim()}". Use: ${TRANSITIONS.join(', ')}` }); return; }
    if (scenes.some((s) => s.n === Number(m[1]))) { issues.push({ line: i + 1, text: t, reason: `Scene ${Number(m[1])} appears twice` }); return; }
    scenes.push({ line: i + 1, n: Number(m[1]), image, motion, transition });
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
    out.visuals.push({ id: uid(), assetId: img.id, duration: dur, prompt: s.motion.replace(/_/g, ' '), transition: i === 0 ? 'cut' : s.transition, transitionDur: transitionLen });
    if (au) out.voices.push({ id: uid(), assetId: au.id });
  });
  return out;
}
