'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, Loader2, Mic, MicOff, Plus, Sparkles, Volume2, VolumeX, X, AlertTriangle } from 'lucide-react';
import { LogoMark } from '@/components/atom-logo';

type Msg = { role: 'user' | 'model'; text: string; image?: string };
type Lang = 'kh' | 'en';

const T = {
  kh: {
    short: 'សួរ AI',
    ask: 'សួរ AI អំពីអេក្រង់នេះ ឬ App ទាំងមូល…', title: 'Atom Assistant', ph: 'សួរ Atom Assistant...', send: 'ផ្ញើ', mic: 'និយាយ', listening: 'កំពុងស្តាប់…', image: 'ផ្ញើរូប',
    noKey: 'សូមដាក់ Gemini key ក្នុង Settings → API Key Vault សិន។', thinking: 'កំពុងគិត…', listen: 'ស្តាប់ចម្លើយ', stop: 'បញ្ឈប់', noSpeech: 'ឧបករណ៍នេះមិនគាំទ្រការនិយាយទេ',
    noTts: 'ឧបករណ៍នេះគ្មានសំឡេងអានភាសាខ្មែរ។ សូមដំឡើង Khmer voice ក្នុង Settings របស់ទូរស័ព្ទ។', usage: 'ការប្រើប្រាស់ថ្ងៃនេះ', close: 'បិទ', ok: 'យល់ព្រម',
    quotaTitle: 'ដល់កម្រិតកំណត់សុវត្ថិភាព',
    quota: (p: number, pct: number) => `ការប្រើប្រាស់ AI របស់អ្នកបានដល់កម្រិតកំណត់សុវត្ថិភាព (${pct}%) ហើយ! ប្រព័ន្ធបានផ្អាកជាបណ្ដោះអាសន្ន ដើម្បីការពារការចំណាយលើសកំណត់។ (បានប្រើ ${p}%) សូមព្យាយាមម្តងទៀតថ្ងៃស្អែក។`,
  },
  en: {
    short: 'Ask AI',
    ask: 'Ask AI about this screen or the whole app…', title: 'Atom Assistant', ph: 'Ask Atom Assistant...', send: 'Send', mic: 'Speak', listening: 'Listening…', image: 'Attach image',
    noKey: 'Add your Gemini key in Settings → API Key Vault first.', thinking: 'Thinking…', listen: 'Read aloud', stop: 'Stop', noSpeech: 'Speech input is not supported on this device',
    noTts: 'This device has no voice for this language. Install one in your phone settings.', usage: "Today's usage", close: 'Close', ok: 'OK',
    quotaTitle: 'Safety limit reached',
    quota: (p: number, pct: number) => `You have reached ${pct}% of your safety quota. Usage is temporarily paused to protect you from extra charges. (Used ${p}%) Please try again tomorrow.`,
  },
} as const;

/** Shrinks a screenshot so the request stays small. */
async function toDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

export function AiAssistant({ screen, language }: { screen: string; language: Lang }) {
  const t = T[language];
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pct, setPct] = useState<number | null>(null);
  const [quota, setQuota] = useState<{ percent: number; buffer: number } | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // the input grows with the text up to 5 lines, then scrolls
  useLayoutEffect(() => { const el = taRef.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 5 * 22 + 4)}px`; }, [text, open]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  useEffect(() => {
    if (!open) return;
    fetch('/api/assistant', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (typeof j.percent === 'number') setPct(j.percent); }).catch(() => undefined);
  }, [open]);
  useEffect(() => () => { window.speechSynthesis?.cancel(); recRef.current?.stop(); }, []);

  const send = async () => {
    if ((!text.trim() && !img) || busy) return;
    const mine: Msg = { role: 'user', text: text.trim(), image: img ?? undefined };
    const history = msgs.slice(-8).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, mine]); setText(''); setImg(null); setErr(''); setBusy(true);
    try {
      const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: mine.text, image: mine.image, screen, language, history }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) { setQuota({ percent: Math.min(100, Number(j.percent) || 98), buffer: Math.round((Number(j.buffer) || 0.98) * 100) }); setMsgs((m) => m.slice(0, -1)); }
      else if (j.error === 'no_key') { setErr(t.noKey); setMsgs((m) => m.slice(0, -1)); }
      else if (!r.ok) { setErr(String(j.error || `Error ${r.status}`)); }
      else { setMsgs((m) => [...m, { role: 'model', text: j.text }]); if (typeof j.percent === 'number') setPct(j.percent); }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Network error'); }
    setBusy(false);
  };

  const mic = () => {
    if (listening) { recRef.current?.stop(); return; }
    const Rec = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition // eslint-disable-line @typescript-eslint/no-explicit-any
      ?? (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!Rec) { setErr(t.noSpeech); return; }
    const r = new Rec();
    r.lang = language === 'kh' ? 'km-KH' : 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => setText((v) => `${v} ${e.results[0][0].transcript}`.trim());
    r.onerror = () => setListening(false); r.onend = () => setListening(false);
    recRef.current = r; setListening(true); setErr('');
    try { r.start(); } catch { setListening(false); }
  };

  const speak = (i: number, s: string) => {
    const synth = window.speechSynthesis;
    if (!synth) { setErr(t.noTts); return; }
    if (speaking === i) { synth.cancel(); setSpeaking(null); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(s.replace(/[*#`_]/g, ''));
    u.lang = language === 'kh' ? 'km-KH' : 'en-US';
    const v = synth.getVoices().find((x) => x.lang.toLowerCase().startsWith(language === 'kh' ? 'km' : 'en'));
    if (language === 'kh' && !v) { setErr(t.noTts); }
    if (v) u.voice = v;
    u.onend = () => setSpeaking(null); u.onerror = () => setSpeaking(null);
    setSpeaking(i); synth.speak(u);
  };

  const pick = async (f?: File) => { if (!f) return; try { setImg(await toDataUrl(f)); } catch { setErr('Could not read the image'); } };

  return <>
    <button type="button" className="ai-bar" onClick={() => setOpen(true)} aria-label={t.title}><Sparkles size={16} /><span>{t.short}</span></button>
    {mounted && createPortal(<>{open && <div className="ai-sheet" role="dialog" aria-label={t.title}>
      <div className="ai-head"><LogoMark size={28} /><strong>{t.title}</strong>
        {pct !== null && <span className="ai-meter" title={t.usage}><i style={{ width: `${Math.min(100, pct)}%` }} /></span>}
        <button type="button" className="icon-button" onClick={() => { window.speechSynthesis?.cancel(); setOpen(false); }} aria-label={t.close}><X size={20} /></button></div>
      <div className="ai-body">
        {msgs.length === 0 && <div className="ai-hero"><LogoMark size={84} /><h2>{t.title}</h2><p className="ai-empty">{t.ask}</p></div>}
        {msgs.map((m, i) => <div key={i} className={`ai-msg ${m.role}`}>
          {m.image && <img src={m.image} alt="" />}
          <p>{m.text}</p>
          {m.role === 'model' && <button type="button" className="text-button" onClick={() => speak(i, m.text)}>{speaking === i ? <><VolumeX size={13} /> {t.stop}</> : <><Volume2 size={13} /> {t.listen}</>}</button>}
        </div>)}
        {busy && <div className="ai-msg model"><p><Loader2 size={14} className="animate-spin" style={{ display: 'inline' }} /> {t.thinking}</p></div>}
        {err && <p className="ai-err">{err}</p>}
        <div ref={endRef} />
      </div>
      {img && <div className="ai-attach"><img src={img} alt="" /><button type="button" onClick={() => setImg(null)} aria-label={t.close}><X size={14} /></button></div>}
      <div className="ai-foot pb-safe">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="ai-pill">
          <button type="button" className="ai-pill-btn" onClick={() => fileRef.current?.click()} aria-label={t.image}><Plus size={22} /></button>
          <textarea ref={taRef} rows={1} className="ai-field" value={text} placeholder={listening ? t.listening : t.ph}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
          <button type="button" className={`ai-pill-btn ${listening ? 'ai-live' : ''}`} onClick={mic} aria-label={t.mic}>{listening ? <MicOff size={20} /> : <Mic size={20} />}</button>
          <button type="button" className="ai-send" onClick={() => void send()} disabled={busy || (!text.trim() && !img)} aria-label={t.send}><ArrowUp size={19} /></button>
        </div>
      </div>
    </div>}
    {quota && <div className="modal-backdrop" onMouseDown={() => setQuota(null)}><div className="ai-quota" role="alertdialog" onMouseDown={(e) => e.stopPropagation()}>
      <AlertTriangle size={28} /><h3>{t.quotaTitle}</h3><p>{t.quota(quota.percent, quota.buffer)}</p>
      <button type="button" className="primary-button" onClick={() => setQuota(null)}>{t.ok}</button></div></div>}</>, document.body)}
  </>;
}
