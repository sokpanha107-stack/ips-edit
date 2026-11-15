'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ArrowLeftRight, ClipboardPaste, Copy, Languages, ListChecks, Play, RefreshCw, Scissors, Square, Volume2, X } from 'lucide-react';
import { api, splitScenes } from '@/lib/client/api';
import { breakScript, detectLang, PRESET_MAX, type Lang, type Preset } from '@/lib/client/scriptTools';

const copy = {
  en: {
    check: 'Check', pasteHere: 'Paste text', arranged: 'Arranged lines', rearrange: 'Re-arrange', edited: 'Edited by hand. Re-arrange rebuilds it from the pasted text.', alignLeft: 'Left', alignCenter: 'Center', alignRight: 'Right', useAsInput: 'Use as input',
    prepare: 'Script Preparation', sendTo: 'Send to', sentTo: 'Sent to', khEngine: 'KH Voice Engine', enEngine: 'EN Voice Engine', videoEngine: 'Video Engine', breakBtn: 'Break into lines', undo: 'Undo', copyScript: 'Copy Script', useResult: 'Use as script', lineCount: 'lines',
    format: 'Format', translate: 'Translate', preview: 'Preview',
    formatTitle: 'Script formatter', rawPh: 'Paste your raw script here…', output: 'Formatted lines', lines: 'lines', numbered: 'Number the lines (Scene 01:)',
    short: 'Short', medium: 'Medium', long: 'Long', paste: 'Paste', copy: 'Copy', copied: 'Copied', insert: 'Use in Batch Scripts', nothing: 'Nothing to copy yet', clear: 'Clear',
    transTitle: 'Translate', khmer: 'Khmer', english: 'English', swap: 'Swap', go: 'Translate', working: 'Translating…', typeHere: 'Type or paste text', result: 'Translation',
    quota: 'The free translation limit for today is used up. Try again tomorrow.', failed: 'Translation failed', speak: 'Listen', proof: 'Machine translation: proofread Khmer before using it.',
    previewTitle: 'Scene preview (device voice)', play: 'Play', stop: 'Stop', from: 'From scene', to: 'Stop at scene', speed: 'Speed', anchor: 'anchor', noScript: 'Add script lines first.',
    noKm: 'This device has no Khmer voice, so Khmer lines may be silent or read wrongly. Install one in Settings > Accessibility > Spoken Content > Voices.', unsupported: 'Speech is not supported in this browser.', spoke: 's',
  },
  kh: {
    check: 'ពិនិត្យ', pasteHere: 'បិទភ្ជាប់អត្ថបទ', arranged: 'អត្ថបទរៀបជាជួរ', rearrange: 'រៀបចំម្តងទៀត', edited: 'អ្នកបានកែដោយដៃ។ ចុច "រៀបចំម្តងទៀត" ដើម្បីបង្កើតឡើងវិញពីអត្ថបទដែលបានបិទភ្ជាប់។', alignLeft: 'ឆ្វេង', alignCenter: 'កណ្តាល', alignRight: 'ស្តាំ', useAsInput: 'ប្រើជាអត្ថបទដើម',
    prepare: 'Script Preparation', sendTo: 'ផ្ញើទៅ', sentTo: 'បានផ្ញើទៅ', khEngine: 'KH Voice Engine', enEngine: 'EN Voice Engine', videoEngine: 'Video Engine', breakBtn: 'កាត់ជាបន្ទាត់', undo: 'ត្រឡប់វិញ', copyScript: 'Copy Script', useResult: 'ប្រើជា script', lineCount: 'បន្ទាត់',
    format: 'រៀបចំ', translate: 'បកប្រែ', preview: 'ស្តាប់សាកល្បង',
    formatTitle: 'រៀបចំ Script', rawPh: 'បិទភ្ជាប់ script ដើមនៅទីនេះ…', output: 'បន្ទាត់ដែលបានរៀបចំ', lines: 'បន្ទាត់', numbered: 'ដាក់លេខបន្ទាត់ (Scene 01:)',
    short: 'ខ្លី', medium: 'មធ្យម', long: 'វែង', paste: 'បិទភ្ជាប់', copy: 'Copy', copied: 'បាន Copy', insert: 'ប្រើក្នុង Batch Scripts', nothing: 'មិនទាន់មានអ្វីត្រូវ Copy', clear: 'សម្អាត',
    transTitle: 'បកប្រែ', khmer: 'ខ្មែរ', english: 'អង់គ្លេស', swap: 'ប្តូរ', go: 'បកប្រែ', working: 'កំពុងបកប្រែ…', typeHere: 'វាយ ឬបិទភ្ជាប់អត្ថបទ', result: 'លទ្ធផលបកប្រែ',
    quota: 'ដែនកំណត់បកប្រែឥតគិតថ្លៃថ្ងៃនេះអស់ហើយ។ សាកល្បងម្តងទៀតថ្ងៃស្អែក។', failed: 'បកប្រែមិនបាន', speak: 'ស្តាប់', proof: 'ការបកប្រែដោយម៉ាស៊ីន៖ សូមពិនិត្យអក្ខរាវិរុទ្ធខ្មែរមុនប្រើ។',
    previewTitle: 'ស្តាប់ scene សាកល្បង (សំឡេងឧបករណ៍)', play: 'ចាក់', stop: 'ឈប់', from: 'ចាប់ពី scene', to: 'ឈប់នៅ scene', speed: 'ល្បឿន', anchor: 'ស្តង់ដារ', noScript: 'សូមដាក់ script សិន។',
    noKm: 'ឧបករណ៍នេះគ្មានសំឡេងខ្មែរ ដូច្នេះបន្ទាត់ខ្មែរអាចស្ងាត់ ឬអានខុស។ ដំឡើងក្នុង Settings > Accessibility > Spoken Content > Voices។', unsupported: 'Browser នេះមិនគាំទ្រការអានសំឡេងទេ។', spoke: 'វិ',
  },
} as const;
type C = (typeof copy)['en'] | (typeof copy)['kh'];
export type Language = 'en' | 'kh';

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="tool-modal" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
    <div className="drawer-header"><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
    <div className="tool-body">{children}</div>
    {footer && <div className="tool-foot">{footer}</div>}
  </div></div>;
}

function PreviewPanel({ c, script, anchor }: { c: C; script: string; anchor: number[] }) {
  const lines = useMemo(() => splitScenes(script), [script]);
  const [from, setFrom] = useState(1);
  const [stopAt, setStopAt] = useState(0);
  const [rate, setRate] = useState(1);
  const [idx, setIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [times, setTimes] = useState<Record<number, number>>({});
  const [hasKm, setHasKm] = useState(true);
  const runId = useRef(0);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const last = stopAt > 0 ? Math.min(stopAt, lines.length) : lines.length;

  useEffect(() => {
    if (!supported) return;
    const refresh = () => setHasKm(window.speechSynthesis.getVoices().some((v) => v.lang.toLowerCase().startsWith('km')));
    refresh();
    window.speechSynthesis.addEventListener?.('voiceschanged', refresh);
    return () => { window.speechSynthesis.removeEventListener?.('voiceschanged', refresh); window.speechSynthesis.cancel(); };
  }, [supported]);

  const stop = useCallback(() => { runId.current += 1; if (supported) window.speechSynthesis.cancel(); setPlaying(false); setIdx(-1); }, [supported]);
  const play = () => {
    if (!supported || !lines.length) return;
    window.speechSynthesis.cancel();
    const id = ++runId.current;
    setPlaying(true); setTimes({});
    const speak = (i: number) => {
      if (id !== runId.current) return;
      if (i >= last) { setPlaying(false); setIdx(-1); return; }
      const lang = detectLang(lines[i]);
      const u = new SpeechSynthesisUtterance(lines[i]);
      u.lang = lang === 'km' ? 'km-KH' : 'en-US'; u.rate = rate;
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
      if (voice) u.voice = voice;
      let t0 = 0;
      u.onstart = () => { t0 = performance.now(); setIdx(i); };
      u.onend = () => { setTimes((t) => ({ ...t, [i]: Math.round(((performance.now() - t0) / 1000) * 10) / 10 })); speak(i + 1); };
      u.onerror = () => { if (id === runId.current) speak(i + 1); };
      window.speechSynthesis.speak(u);
    };
    speak(Math.max(0, from - 1));
  };
  useEffect(() => () => { runId.current += 1; }, []);

  if (!supported) return <div className="preview-panel flat"><p className="access-help">{c.unsupported}</p></div>;
  const needsKm = lines.some((l) => detectLang(l) === 'km') && !hasKm;
  return <div className="preview-panel">
    <div className="tool-label">{c.previewTitle}</div>
    {lines.length === 0 ? <p className="access-help">{c.noScript}</p> : <>
      <div className="preview-controls">
        <label>{c.from}<input className="studio-input" inputMode="numeric" value={from} onChange={(e) => setFrom(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))} /></label>
        <label>{c.to}<input className="studio-input" inputMode="numeric" value={stopAt || ''} placeholder={String(lines.length)} onChange={(e) => setStopAt(Number(e.target.value.replace(/\D/g, '')) || 0)} /></label>
        <label>{c.speed} {rate.toFixed(1)}×<input type="range" min="0.6" max="1.5" step="0.1" value={rate} onChange={(e) => setRate(Number(e.target.value))} /></label>
        {playing ? <button type="button" className="primary-button" onClick={stop}><Square size={14} /> {c.stop}</button> : <button type="button" className="primary-button" onClick={play}><Play size={14} fill="currentColor" /> {c.play}</button>}
      </div>
      {needsKm && <div className="access-status bad">{c.noKm}</div>}
      <ol className="preview-list">{lines.map((l, i) => {
        const a = anchor[i]; const t = times[i];
        return <li key={i} className={i === idx ? 'now' : ''} onClick={() => setFrom(i + 1)}><b>{String(i + 1).padStart(2, '0')}</b><span>{l}</span>
          <em className={a && t && t > a * 1.1 ? 'over' : ''}>{t !== undefined ? `${t}${c.spoke}` : ''}{a ? ` · ${c.anchor} ${a}${c.spoke}` : ''}</em></li>;
      })}</ol></>}
  </div>;
}

type Tab = 'check' | 'translate' | 'preview';
type Align = 'left' | 'center' | 'right';
const NEXT_ALIGN: Record<Align, Align> = { center: 'left', left: 'right', right: 'center' };

type Target = 'kh' | 'en' | 'video';

/** The standalone Script Preparation workspace (a normal screen, not a modal). */
function Workspace({ c, anchor, onSend, onNotice }: {
  c: C; anchor: number[]; onSend: (target: Target, text: string) => void; onNotice: (m: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('check');
  const [text, setText] = useState('');            // what the user pastes
  const [arranged, setArranged] = useState('');    // short lines, one per scene; editable by hand
  const [dirty, setDirty] = useState(false);       // arranged was edited by hand: do not overwrite it automatically
  const [preset, setPreset] = useState<Preset>('medium');
  const [numbered, setNumbered] = useState(false);
  const [align, setAlign] = useState<Align>('center');
  const [from, setFrom] = useState<Lang>('km');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const to: Lang = from === 'km' ? 'en' : 'km';
  const name = (l: Lang) => (l === 'km' ? c.khmer : c.english);
  const lineCount = arranged.split(/\r?\n/).filter((l) => l.trim()).length;
  const AlignIcon = align === 'left' ? AlignLeft : align === 'right' ? AlignRight : AlignCenter;

  // live: rebuild the arranged lines whenever the pasted text or the settings change (unless edited by hand)
  useEffect(() => { if (!dirty) setArranged(breakScript(text, preset, numbered).join('\n')); }, [text, preset, numbered, dirty]);

  const change = (v: string) => { setText(v); if (v.trim().length > 3) { const d = detectLang(v); if (d !== from) setFrom(d); } };
  const paste = async () => { try { change(await navigator.clipboard.readText()); } catch { onNotice('Paste blocked: long-press the box and choose Paste.'); } };
  const rearrange = () => { setDirty(false); setArranged(breakScript(text, preset, numbered).join('\n')); };
  const result = arranged.trim() ? arranged : text;
  const doCopy = async () => { if (!result.trim()) { onNotice(c.nothing); return; } onNotice((await copyText(result)) ? c.copied : 'Copy failed'); };
  const go = async () => {
    if (!text.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await api.translate(text, from, to);
      if (r.ok && r.text !== undefined) setOut(r.text); else setError(r.error === 'quota' ? c.quota : `${c.failed}${r.error ? `: ${r.error}` : ''}`);
    } catch (e) { setError(e instanceof Error ? e.message : c.failed); }
    setBusy(false);
  };
  const speak = (t: string, lang: Lang) => {
    if (!('speechSynthesis' in window) || !t) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t); u.lang = lang === 'km' ? 'km-KH' : 'en-US'; window.speechSynthesis.speak(u);
  };

  const send = (t: Target) => { if (result.trim()) { onSend(t, result); onNotice(`${c.sentTo} ${t === 'kh' ? c.khEngine : t === 'en' ? c.enEngine : c.videoEngine}`); } else onNotice(c.nothing); };

  return <section className="screen-card script-screen">
    <div className="screen-heading"><div className="section-heading"><div className="heading-icon"><Scissors size={18} /></div><div className="heading-only"><span className="eyebrow">{c.prepare}</span></div></div></div>
    <div className="tool-tabs" role="tablist">
      {([['check', Scissors, c.check], ['translate', Languages, c.translate], ['preview', Volume2, c.preview]] as const).map(([k, Icon, label]) =>
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tool-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}><Icon size={14} /> {label}</button>)}
    </div>

    {tab === 'check' && <div className="tool-section">
      <div className="check-grid">
        <div className="check-pane">
          <div className="tool-row"><span className="tool-label">{c.pasteHere}</span><span className="tool-actions">
            <button type="button" className="text-button" onClick={paste}><ClipboardPaste size={14} /> {c.paste}</button>
            {text && <button type="button" className="text-button" onClick={() => { setText(''); setDirty(false); }}>{c.clear}</button>}</span></div>
          <textarea className="studio-input tool-area" value={text} placeholder={c.rawPh} onChange={(e) => change(e.target.value)} />
        </div>
        <div className="check-pane">
          <div className="tool-row"><span className="tool-label">{c.arranged} · {lineCount} {c.lineCount}</span><span className="tool-actions">
            <button type="button" className="icon-button sm" onClick={() => setAlign(NEXT_ALIGN[align])} aria-label={`${c.alignCenter}/${c.alignLeft}/${c.alignRight}`} title={align === 'left' ? c.alignLeft : align === 'right' ? c.alignRight : c.alignCenter}><AlignIcon size={15} /></button>
            <button type="button" className={`text-button ${dirty ? 'attn' : ''}`} onClick={rearrange}><RefreshCw size={13} /> {c.rearrange}</button></span></div>
          <textarea className="studio-input tool-area arranged" style={{ textAlign: align }} value={arranged} placeholder={c.output}
            onChange={(e) => { setArranged(e.target.value); setDirty(true); }} />
          {dirty && <p className="access-help">{c.edited}</p>}
        </div>
      </div>
      <div className="tool-row"><div className="chip-row">{(['short', 'medium', 'long'] as Preset[]).map((p) => <button key={p} type="button" className={`chip ${preset === p ? 'on' : ''}`} onClick={() => { setPreset(p); setDirty(false); }}>{c[p]} · {PRESET_MAX[p]}</button>)}</div>
        <label className="check-label"><input type="checkbox" checked={numbered} onChange={(e) => { setNumbered(e.target.checked); setDirty(false); }} /> {c.numbered}</label></div>
    </div>}

    {tab === 'translate' && <div className="tool-section">
      <div className="lang-bar"><span className="lang-pill">{name(from)}</span><button type="button" className="icon-button" onClick={() => { setFrom(to); if (out) { setText(out); setOut(''); setDirty(false); } }} aria-label={c.swap}><ArrowLeftRight size={16} /></button><span className="lang-pill">{name(to)}</span></div>
      <textarea className="studio-input tool-area" value={text} placeholder={c.typeHere} onChange={(e) => change(e.target.value)} />
      <textarea className="studio-input tool-area out" readOnly value={busy ? c.working : out} placeholder={c.result} />
      <div className="pane-foot"><button type="button" className="icon-button sm" onClick={() => speak(out, to)} aria-label={c.speak}><Volume2 size={14} /></button>
        <button type="button" className="icon-button sm" onClick={async () => onNotice(out ? ((await copyText(out)) ? c.copied : 'Copy failed') : c.nothing)} aria-label={c.copy}><Copy size={14} /></button>
        <button type="button" className="text-button" onClick={() => { if (out) { setText(out); setOut(''); setDirty(false); setTab('check'); } else onNotice(c.nothing); }}>{c.useAsInput}</button></div>
      {error && <div className="access-status bad">{error}</div>}
      <button type="button" className="primary-button" onClick={go} disabled={busy || !text.trim()}><Languages size={15} /> {busy ? c.working : c.go}</button>
      <p className="access-help">{c.proof}</p>
    </div>}

    {tab === 'preview' && <PreviewPanel c={c} script={result} anchor={anchor} />}
    <div className="tool-foot">
      <button type="button" className="primary-button big-copy" onClick={doCopy}><Copy size={16} /> {c.copyScript}</button>
      <div className="send-row"><span className="tool-label">{c.sendTo}</span>
        {(['kh', 'video', 'en'] as Target[]).map((t) => <button key={t} type="button" className="text-button send-chip" onClick={() => send(t)}><ListChecks size={13} /> {t === 'kh' ? c.khEngine : t === 'en' ? c.enEngine : c.videoEngine}</button>)}</div>
    </div>
  </section>;
}

export function ScriptPrepScreen({ language, anchor, onSend, onNotice }: { language: Language; anchor: number[]; onSend: (target: Target, text: string) => void; onNotice: (m: string) => void }) {
  return <Workspace c={copy[language]} anchor={anchor} onSend={onSend} onNotice={onNotice} />;
}
