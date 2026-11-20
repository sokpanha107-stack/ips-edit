'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeftRight, ArrowUp, ClipboardPaste, Copy, Languages, ListChecks, Play, Scissors, Square, Volume2, X } from 'lucide-react';
import { api } from '@/lib/client/api';
import { detectLang, detectScenes, formatBreath, tidy, type Breath, type Lang } from '@/lib/client/scriptTools';
import { LogoMark } from '@/components/atom-logo';

const copy = {
  en: {
    check: 'Check', pasteHere: 'Paste text', arranged: 'Arranged lines', rearrange: 'Re-arrange', edited: 'Edited by hand. Re-arrange rebuilds it from the pasted text.', alignLeft: 'Left', alignCenter: 'Center', alignRight: 'Right', useAsInput: 'Use as input',
    playAll: 'Play All', stopAll: 'Stop', addScene: 'Add scene', prepare: 'Script Preparation', sendTo: 'Send to', sentTo: 'Sent to', khEngine: 'KH Voice Engine', enEngine: 'EN Voice Engine', videoEngine: 'Video Engine', breakBtn: 'Break into lines', undo: 'Undo', copyScript: 'Copy Script', useResult: 'Use as script', lineCount: 'lines',
    format: 'Format', translate: 'Translate', preview: 'Preview', aiAssist: 'AI Assist', formatBreath: 'Format Breath / Clauses', breath: 'Breath', bShort: 'Short', bNatural: 'Natural', bStory: 'Story', scenesWord: 'Scenes', allText: 'Full script (all scenes)', imageEngine: 'Image Engine', timelineEditor: 'Timeline Editor', moveUp: 'Move up', moveDown: 'Move down', aiDone: 'Atom AI Assist: scenes arranged', nothingToFormat: 'Paste or write a script first',
    formatTitle: 'Script formatter', rawPh: 'Paste your raw script here…', output: 'Formatted lines', lines: 'lines', numbered: 'Number the lines (Scene 01:)',
    short: 'Short', medium: 'Medium', long: 'Long', paste: 'Paste', copy: 'Copy', copied: 'Copied', insert: 'Use in Batch Scripts', nothing: 'Nothing to copy yet', clear: 'Clear',
    transTitle: 'Translate', khmer: 'Khmer', english: 'English', swap: 'Swap', go: 'Translate', working: 'Translating…', typeHere: 'Type or paste text', result: 'Translation',
    quota: 'The free translation limit for today is used up. Try again tomorrow.', failed: 'Translation failed', speak: 'Listen', proof: 'Machine translation: proofread Khmer before using it.',
    previewTitle: 'Scene preview (device voice)', play: 'Play', stop: 'Stop', from: 'From scene', to: 'Stop at scene', speed: 'Speed', anchor: 'anchor', noScript: 'Add script lines first.',
    noKm: 'This device has no Khmer voice, so Khmer lines may be silent or read wrongly. Install one in Settings > Accessibility > Spoken Content > Voices.', unsupported: 'Speech is not supported in this browser.', spoke: 's',
  },
  kh: {
    check: 'ពិនិត្យ', pasteHere: 'បិទភ្ជាប់អត្ថបទ', arranged: 'អត្ថបទរៀបជាជួរ', rearrange: 'រៀបចំម្តងទៀត', edited: 'អ្នកបានកែដោយដៃ។ ចុច "រៀបចំម្តងទៀត" ដើម្បីបង្កើតឡើងវិញពីអត្ថបទដែលបានបិទភ្ជាប់។', alignLeft: 'ឆ្វេង', alignCenter: 'កណ្តាល', alignRight: 'ស្តាំ', useAsInput: 'ប្រើជាអត្ថបទដើម',
    playAll: 'ចាក់ទាំងអស់', stopAll: 'ឈប់', addScene: 'បន្ថែម scene', prepare: 'Script Preparation', sendTo: 'ផ្ញើទៅ', sentTo: 'បានផ្ញើទៅ', khEngine: 'KH Voice Engine', enEngine: 'EN Voice Engine', videoEngine: 'Video Engine', breakBtn: 'កាត់ជាបន្ទាត់', undo: 'ត្រឡប់វិញ', copyScript: 'Copy Script', useResult: 'ប្រើជា script', lineCount: 'បន្ទាត់',
    format: 'រៀបចំ', translate: 'បកប្រែ', preview: 'ស្តាប់សាកល្បង', aiAssist: 'AI ជួយ', formatBreath: 'រៀបដង្ហើម / Clauses', breath: 'ដង្ហើម', bShort: 'ខ្លី', bNatural: 'ធម្មតា', bStory: 'រឿង', scenesWord: 'Scenes', allText: 'Script ទាំងមូល (គ្រប់ Scene)', imageEngine: 'Image Engine', timelineEditor: 'Timeline Editor', moveUp: 'ឡើងលើ', moveDown: 'ចុះក្រោម', aiDone: 'Atom AI ជួយរៀបចំ Scene រួចរាល់', nothingToFormat: 'សូមបិទភ្ជាប់ ឬសរសេរ script សិន',
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

/** Speaks scene lines with the free device voice (window.speechSynthesis). One scene or a run of scenes; always cancels what was playing first. */
function useScenePlayer(getLines: () => string[], rate: number) {
  const [supported, setSupported] = useState(false);   // decided after mount so server and client HTML match
  useEffect(() => setSupported('speechSynthesis' in window), []);
  const [now, setNow] = useState(-1);                       // scene being spoken
  const [mode, setMode] = useState<'idle' | 'all' | 'one'>('idle');
  const [times, setTimes] = useState<Record<number, number>>({});
  const [hasKm, setHasKm] = useState(true);
  const runId = useRef(0);

  useEffect(() => {
    if (!supported) return;
    const refresh = () => setHasKm(window.speechSynthesis.getVoices().some((v) => v.lang.toLowerCase().startsWith('km')));
    refresh();
    window.speechSynthesis.addEventListener?.('voiceschanged', refresh);
    return () => { runId.current += 1; window.speechSynthesis.removeEventListener?.('voiceschanged', refresh); window.speechSynthesis.cancel(); };
  }, [supported]);

  const stop = useCallback(() => { runId.current += 1; if (supported) window.speechSynthesis.cancel(); setMode('idle'); setNow(-1); }, [supported]);
  const run = useCallback((start: number, onlyOne: boolean) => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const id = ++runId.current;
    setMode(onlyOne ? 'one' : 'all'); setNow(-1);
    if (!onlyOne) setTimes({});
    const speak = (i: number) => {
      const lines = getLines();
      if (id !== runId.current) return;
      if (i >= lines.length || (onlyOne && i > start)) { setMode('idle'); setNow(-1); return; }
      const text = lines[i].replace(/^\s*\d+\s*[.):-]\s*/, '').trim();
      if (!text) { speak(i + 1); return; }
      const lang = detectLang(text);
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'km' ? 'km-KH' : 'en-US'; u.rate = rate;
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
      if (voice) u.voice = voice;
      let t0 = 0;
      u.onstart = () => { t0 = performance.now(); setNow(i); };
      u.onend = () => { setTimes((t) => ({ ...t, [i]: Math.round(((performance.now() - t0) / 1000) * 10) / 10 })); speak(i + 1); };
      u.onerror = () => { if (id === runId.current) speak(i + 1); };
      window.speechSynthesis.speak(u);
    };
    speak(start);
  }, [supported, getLines, rate]);

  return { supported, now, mode, times, hasKm, stop, playAll: () => run(0, false), playOne: (i: number) => run(i, true) };
}

type Tab = 'check' | 'translate';
type Align = 'left' | 'center' | 'right';
export type Target = 'kh' | 'en' | 'image' | 'timeline';
const STORE = 'ips-script-scenes';

/** The standalone Script Preparation workspace. `scenes` is the single source of truth: the full-script box and every Scene card edit it. */
function Workspace({ c, anchor, onSend, onNotice }: {
  c: C; anchor: number[]; onSend: (target: Target, scenes: string[]) => void; onNotice: (m: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('check');
  const [scenes, setScenes] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [breath, setBreath] = useState<Breath>('natural');
  const [align, setAlign] = useState<Align>('left');
  const [tText, setTText] = useState('');
  const [from, setFrom] = useState<Lang>('km');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rate, setRate] = useState(1);
  const to: Lang = from === 'km' ? 'en' : 'km';
  const linesRef = useRef<string[]>([]);
  linesRef.current = scenes;
  const getLines = useCallback(() => linesRef.current, []);
  const player = useScenePlayer(getLines, rate);

  useEffect(() => { try { const d = JSON.parse(localStorage.getItem(STORE) ?? 'null'); if (Array.isArray(d)) setScenes(d.map(String)); } catch { /* ignore */ } setLoaded(true); }, []);
  useEffect(() => { if (loaded) try { localStorage.setItem(STORE, JSON.stringify(scenes)); } catch { /* ignore */ } }, [loaded, scenes]);

  const filled = scenes.filter((s) => s.trim());
  const count = filled.length;
  const name = (l: Lang) => (l === 'km' ? c.khmer : c.english);

  // full-script box: a paste re-detects the scenes, normal typing just follows the lines (nothing else is reset)
  const onMain = (v: string) => {
    const grew = v.length - scenes.join('\n').length;
    setScenes(grew > 40 || !scenes.length ? detectScenes(v) : v.split('\n'));
  };
  const compact = () => setScenes((s) => s.map((x) => x.trim()).filter(Boolean));
  const setRow = (i: number, v: string) => setScenes((s) => s.map((x, k) => (k === i ? v.replace(/\r?\n/g, ' ') : x)));
  const delRow = (i: number) => { player.stop(); setScenes((s) => s.filter((_, k) => k !== i)); };
  const addRow = () => setScenes((s) => [...s, '']);
  const move = (i: number, d: -1 | 1) => { player.stop(); setScenes((s) => { const j = i + d; if (j < 0 || j >= s.length) return s; const n = s.slice(); [n[i], n[j]] = [n[j], n[i]]; return n; }); };
  const paste = async () => { try { setScenes(detectScenes(await navigator.clipboard.readText())); } catch { onNotice('Paste blocked: long-press the box and choose Paste.'); } };

  const formatNow = (mode: Breath) => { if (!count) { onNotice(c.nothingToFormat); return false; } setScenes(formatBreath(scenes.map(tidy), mode)); return true; };
  /** One tap: clean spacing, detect scenes, and set the breath rhythm locally (instant, no network). */
  const aiAssist = () => { if (formatNow(breath)) onNotice(c.aiDone); };

  const text = scenes.join('\n');
  const doCopy = async () => { if (!count) { onNotice(c.nothing); return; } onNotice((await copyText(filled.join('\n'))) ? c.copied : 'Copy failed'); };
  const go = async () => {
    if (!tText.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await api.translate(tText, from, to);
      if (r.ok && r.text !== undefined) setOut(r.text); else setError(r.error === 'quota' ? c.quota : `${c.failed}${r.error ? `: ${r.error}` : ''}`);
    } catch (e) { setError(e instanceof Error ? e.message : c.failed); }
    setBusy(false);
  };
  const speak = (t: string, lang: Lang) => {
    if (!('speechSynthesis' in window) || !t) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t); u.lang = lang === 'km' ? 'km-KH' : 'en-US'; window.speechSynthesis.speak(u);
  };
  const label = (t: Target) => (t === 'kh' ? c.khEngine : t === 'en' ? c.enEngine : t === 'image' ? c.imageEngine : c.timelineEditor);
  const send = (t: Target) => { if (!count) { onNotice(c.nothing); return; } player.stop(); onSend(t, filled.map(tidy)); onNotice(`${c.sentTo} ${label(t)} · ${count} ${c.scenesWord}`); };
  const ALIGNS: [Align, typeof AlignLeft, string][] = [['left', AlignLeft, c.alignLeft], ['center', AlignCenter, c.alignCenter], ['right', AlignRight, c.alignRight]];

  return <section className="screen-card script-screen">
    <div className="screen-heading"><div className="section-heading"><div className="heading-icon"><Scissors size={18} /></div><div className="heading-only"><span className="eyebrow">{c.prepare}</span></div></div></div>
    <div className="tool-tabs" role="tablist">
      {([['check', Scissors, c.check], ['translate', Languages, c.translate]] as const).map(([k, Icon, label]) =>
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tool-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}><Icon size={14} /> {label}</button>)}
    </div>

    {tab === 'check' && <div className="tool-section">
      <div className="sp-toolbar">
        <button type="button" className="ai-assist" onClick={aiAssist}><LogoMark size={20} /> {c.aiAssist}</button>
        <div className="seg" role="group" aria-label={c.breath}>{(['short', 'natural', 'story'] as Breath[]).map((b) => <button key={b} type="button" aria-pressed={breath === b} className={breath === b ? 'on' : ''} onClick={() => setBreath(b)}>{b === 'short' ? c.bShort : b === 'natural' ? c.bNatural : c.bStory}</button>)}</div>
        <button type="button" className="text-button" onClick={() => formatNow(breath)}><Scissors size={13} /> {c.formatBreath}</button>
        <div className="seg" role="group" aria-label="Alignment">{ALIGNS.map(([a, I, l]) => <button key={a} type="button" aria-label={l} aria-pressed={align === a} className={align === a ? 'on' : ''} onClick={() => setAlign(a)}><I size={15} /></button>)}</div>
      </div>
      <div className="check-grid">
        <div className="check-pane">
          <div className="tool-row"><span className="tool-label">{c.allText}</span><span className="tool-actions">
            <button type="button" className="text-button" onClick={paste}><ClipboardPaste size={14} /> {c.paste}</button>
            {scenes.length > 0 && <button type="button" className="text-button" onClick={() => { player.stop(); setScenes([]); }}>{c.clear}</button>}</span></div>
          <textarea className="studio-input tool-area" value={text} style={{ textAlign: align }} placeholder={c.rawPh} onChange={(e) => onMain(e.target.value)} onBlur={compact} />
        </div>
        <div className="check-pane">
          <div className="tool-row"><span className="tool-label scene-count">{c.arranged} • {count} {c.scenesWord}</span></div>
          <div className="play-bar">
            {player.mode === 'idle'
              ? <button type="button" className="primary-button" onClick={player.playAll} disabled={!player.supported || !count}><Play size={14} fill="currentColor" /> {c.playAll}</button>
              : <button type="button" className="primary-button" onClick={player.stop}><Square size={14} fill="currentColor" /> {c.stopAll}</button>}
            <label className="speed">{c.speed} {rate.toFixed(1)}×<input type="range" min="0.6" max="1.5" step="0.1" value={rate} onChange={(e) => setRate(Number(e.target.value))} /></label>
          </div>
          {!player.supported && <div className="access-status bad">{c.unsupported}</div>}
          {player.supported && !player.hasKm && scenes.some((r) => detectLang(r) === 'km') && <div className="access-status bad">{c.noKm}</div>}
          <ol className="scene-list">
            {scenes.map((t, i) => {
              const a = anchor[i]; const tm = player.times[i];
              return <li key={i} className={`scene-row ${player.now === i ? 'now' : ''}`}>
                <div className="scene-head"><b>Scene {String(i + 1).padStart(2, '0')}</b>
                  <em className={a && tm && tm > a * 1.1 ? 'over' : ''}>{tm !== undefined ? `${tm}${c.spoke}` : ''}{a ? ` · ${c.anchor} ${a}${c.spoke}` : ''}</em>
                  <span className="scene-btns">
                    {player.mode !== 'idle' && player.now === i
                      ? <button type="button" className="icon-button sm" onClick={player.stop} aria-label={`${c.stop} scene ${i + 1}`}><Square size={13} fill="currentColor" /></button>
                      : <button type="button" className="icon-button sm" onClick={() => player.playOne(i)} disabled={!player.supported || !t.trim()} aria-label={`${c.play} scene ${i + 1}`}><Play size={13} fill="currentColor" /></button>}
                    <button type="button" className="icon-button sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={c.moveUp}><ArrowUp size={13} /></button>
                    <button type="button" className="icon-button sm" onClick={() => move(i, 1)} disabled={i === scenes.length - 1} aria-label={c.moveDown}><ArrowDown size={13} /></button>
                    <button type="button" className="icon-button sm" onClick={() => delRow(i)} aria-label="Delete scene"><X size={13} /></button>
                  </span></div>
                <textarea className="scene-text" rows={Math.max(1, Math.ceil(t.length / 28))} style={{ textAlign: align }} value={t} placeholder={c.output} onChange={(e) => setRow(i, e.target.value)} />
              </li>;
            })}
          </ol>
          <button type="button" className="text-button" onClick={addRow}>+ {c.addScene}</button>
        </div>
      </div>
    </div>}

    {tab === 'translate' && <div className="tool-section">
      <div className="lang-bar"><span className="lang-pill">{name(from)}</span><button type="button" className="icon-button" onClick={() => { setFrom(to); if (out) { setTText(out); setOut(''); } }} aria-label={c.swap}><ArrowLeftRight size={16} /></button><span className="lang-pill">{name(to)}</span></div>
      <textarea className="studio-input tool-area" value={tText} placeholder={c.typeHere} onChange={(e) => { setTText(e.target.value); if (e.target.value.trim().length > 3) { const d = detectLang(e.target.value); if (d !== from) setFrom(d); } }} />
      <textarea className="studio-input tool-area out" readOnly value={busy ? c.working : out} placeholder={c.result} />
      <div className="pane-foot"><button type="button" className="icon-button sm" onClick={() => speak(out, to)} aria-label={c.speak}><Volume2 size={14} /></button>
        <button type="button" className="icon-button sm" onClick={async () => onNotice(out ? ((await copyText(out)) ? c.copied : 'Copy failed') : c.nothing)} aria-label={c.copy}><Copy size={14} /></button>
        <button type="button" className="text-button" onClick={() => { if (out) { setScenes(detectScenes(out)); setOut(''); setTab('check'); } else onNotice(c.nothing); }}>{c.useResult}</button></div>
      {error && <div className="access-status bad">{error}</div>}
      <button type="button" className="primary-button" onClick={go} disabled={busy || !tText.trim()}><Languages size={15} /> {busy ? c.working : c.go}</button>
      <p className="access-help">{c.proof}</p>
    </div>}

    <div className="tool-foot">
      <button type="button" className="primary-button big-copy" onClick={doCopy}><Copy size={16} /> {c.copyScript}</button>
      <div className="send-row"><span className="tool-label">{c.sendTo}</span>
        {(['kh', 'en', 'image', 'timeline'] as Target[]).map((t) => <button key={t} type="button" className="text-button send-chip" onClick={() => send(t)}><ListChecks size={13} /> {label(t)}</button>)}</div>
    </div>
  </section>;
}

export function ScriptPrepScreen({ language, anchor, onSend, onNotice }: { language: Language; anchor: number[]; onSend: (target: Target, scenes: string[]) => void; onNotice: (m: string) => void }) {
  return <Workspace c={copy[language]} anchor={anchor} onSend={onSend} onNotice={onNotice} />;
}
