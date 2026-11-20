import { splitScenes } from '@/lib/client/api';

/** Pure text helpers for the script tools (no React): language detection and the sentence breaker. */
export type Lang = 'km' | 'en';
export type Preset = 'short' | 'medium' | 'long';
export const PRESET_MAX: Record<Preset, number> = { short: 24, medium: 38, long: 56 };

const KHMER = /[ក-៿]/g;
export function detectLang(text: string): Lang {
  const khmer = (text.match(KHMER) ?? []).length;
  const letters = text.replace(/[\s\d.,!?;:'"()\-–—។៕]/g, '').length || 1;
  return khmer / letters > 0.3 ? 'km' : 'en';
}

const len = (s: string) => Array.from(s).length;
const EN_CONJ = new Set(['and', 'but', 'because', 'which', 'that', 'so', 'then', 'or', 'while', 'when', 'if', 'as', 'where', 'although', 'though', 'after', 'before', 'until', 'since']);
const KM_CONJ = ['ហើយ', 'ប៉ុន្តែ', 'ដោយសារ', 'ដូច្នេះ', 'ព្រោះ', 'ពេល', 'ដែល', 'ឬ', 'ទោះបីជា', 'នៅពេល', 'ដើម្បី', 'បើ', 'ដូចជា', 'ខណៈ'];
const isConj = (w: string, lang: Lang) => (lang === 'km' ? KM_CONJ.includes(w) : EN_CONJ.has(w.toLowerCase().replace(/[^a-z]/g, '')));

/** Cut after ។ ៕ ! ? … and after "." that ends a sentence (not decimals). */
export function sentences(par: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < par.length; i++) {
    cur += par[i];
    const ch = par[i];
    const dot = ch === '.' && !/\d/.test(par[i - 1] ?? '') && (par[i + 1] === undefined || /\s/.test(par[i + 1]));
    if (ch === '។' || ch === '៕' || ch === '!' || ch === '?' || ch === '…' || dot) {
      while (par[i + 1] && /[។៕!?.…"'”’)\]]/.test(par[i + 1])) cur += par[++i];
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Split an over-long unbroken run (Khmer has no spaces inside a phrase) without cutting a letter from its vowel/sign marks. */
function hardSplit(word: string, max: number, lang: Lang): string[] {
  const parts: string[] = [];
  let cur = '';
  const flush = () => { if (cur) { parts.push(cur); cur = ''; } };
  const SegmenterCtor = (Intl as unknown as { Segmenter?: new (l: string, o: object) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (lang === 'km' && SegmenterCtor) {
    for (const { segment } of Array.from(new SegmenterCtor('km', { granularity: 'word' }).segment(word))) {
      if (cur && len(cur + segment) > max) flush();
      cur += segment;
    }
    flush();
    return parts;
  }
  const chars = Array.from(word);
  for (let i = 0; i < chars.length; i++) {
    cur += chars[i];
    const next = chars[i + 1];
    const joins = next && /[ា-៓៝]/.test(next);   // next char is a vowel/sign: keep with this letter
    const coeng = chars[i] === '្';
    if (len(cur) >= max && !joins && !coeng) flush();
  }
  flush();
  return parts;
}

function pack(words: string[], max: number, min: number, lang: Lang): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const raw of words) {
    for (const w of len(raw) > max ? hardSplit(raw, max, lang) : [raw]) {
      const cand = cur ? `${cur} ${w}` : w;
      const breakBeforeConj = !!cur && isConj(w, lang) && len(cur) >= min && len(cand) > max * 0.7;
      if (!cur) cur = w;
      else if (len(cand) <= max && !breakBeforeConj) cur = cand;
      else { lines.push(cur); cur = w; }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function breakSentence(s: string, max: number, lang: Lang): string[] {
  const min = Math.max(6, Math.round(max * 0.4));
  if (len(s) <= max) return [s];
  // strong boundaries: commas, semicolons, colons, dashes. Tiny pieces are glued to the next one.
  const pieces: string[] = [];
  for (const p of s.replace(/([,;:،—–])\s+/g, '$1\u0001').split('\u0001')) {
    if (pieces.length && len(pieces[pieces.length - 1]) < min) pieces[pieces.length - 1] += ` ${p}`;
    else pieces.push(p);
  }
  const lines: string[] = [];
  for (const p of pieces) lines.push(...(len(p) <= max ? [p] : pack(p.split(/\s+/).filter(Boolean), max, min, lang)));
  // orphan lines (a word or two) are merged back into the previous line when the result is still comfortable
  for (let i = lines.length - 1; i > 0; i--) {
    if (len(lines[i]) < min && len(`${lines[i - 1]} ${lines[i]}`) <= max * 1.3) lines.splice(i - 1, 2, `${lines[i - 1]} ${lines[i]}`);
  }
  return lines;
}

/** Raw paragraph(s) -> short, rhythmic lines: one line = one scene. */
export function breakScript(raw: string, preset: Preset = 'medium', numbered = false): string[] {
  const max = PRESET_MAX[preset];
  const out: string[] = [];
  for (const para of raw.replace(/\r/g, '').split(/\n+/)) {
    const text = para.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    for (const s of sentences(text)) out.push(...breakSentence(s, max, detectLang(s)));
  }
  return numbered ? out.map((l, i) => `Scene ${String(i + 1).padStart(2, '0')}: ${l}`) : out;
}

/** Breath modes: how long one spoken clause may be. Only whitespace changes; every word is kept. */
export type Breath = 'short' | 'natural' | 'story';
export const BREATH_MAX: Record<Breath, number> = { short: 26, natural: 40, story: 60 };

/** Pasted text -> scenes with no length limit and no count cap. Explicit "Scene N" / "N." markers or one line per scene win;
 *  a single unbroken block is cut at sentence ends only. */
export function detectScenes(raw: string): string[] {
  const t = raw.replace(/\r/g, '').trim();
  if (!t) return [];
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const marked = /^(scene|ឈុត|ឆាក)\s*\d+|^\d+\s*[.):-]/i.test(lines[0]);
  if (lines.length > 1 || marked) return splitScenes(t).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return sentences(lines[0].replace(/\s+/g, ' '));
}

/** Local, instant breath formatter: sentences -> clauses of the chosen breath length. Scene order is kept. */
export function formatBreath(scenes: string[], mode: Breath): string[] {
  const max = BREATH_MAX[mode];
  const out: string[] = [];
  for (const sc of scenes) {
    const text = sc.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    for (const s of sentences(text)) out.push(...breakSentence(s, max, detectLang(s)));
  }
  return out;
}

/** Tidy spacing around punctuation without touching any word. */
export const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?។៕])/g, '$1').trim();
