'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ClipboardCopy, Library, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { api, type PromptFull, type PromptSummary } from '@/lib/client/api';

type Mode = 'view' | 'edit' | 'new';

/** Works on iPhone Safari too: falls back to a hidden textarea when the Clipboard API is blocked. */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
  } catch { return false; }
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Vault for big Master Prompts: pick one on the left, press ONE button on the right to copy all of it. */
export function PromptLibrary({ active, onNotice }: { active: boolean; onNotice: (m: string) => void }) {
  const [items, setItems] = useState<PromptSummary[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [current, setCurrent] = useState<PromptFull | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);   // phones show the list OR the prompt

  const refresh = useCallback(async () => {
    try { const r = await api.listPrompts(); setItems(r.prompts); setPersistent(r.persistent); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the vault.'); }
    setLoading(false);
  }, []);
  useEffect(() => { if (active) void refresh(); }, [active, refresh]);

  const open = async (id: string) => {
    setConfirmDel(false); setMode('view'); setDetailOpen(true);
    try { setCurrent((await api.getPrompt(id)).prompt); } catch (e) { onNotice(e instanceof Error ? e.message : 'Could not open this prompt.'); }
  };
  const startNew = () => { setCurrent(null); setTitle(''); setContent(''); setMode('new'); setDetailOpen(true); setConfirmDel(false); };
  const startEdit = () => { if (!current) return; setTitle(current.title); setContent(current.content); setMode('edit'); setConfirmDel(false); };
  const cancel = () => { setMode('view'); if (!current) setDetailOpen(false); };

  const save = async () => {
    if (!title.trim() || !content.trim()) { onNotice('Give it a title and paste the prompt.'); return; }
    setSaving(true);
    try {
      const r = mode === 'edit' && current ? await api.updatePrompt(current.id, title.trim(), content) : await api.createPrompt(title.trim(), content);
      setCurrent(r.prompt); setMode('view'); onNotice('Saved to the vault'); await refresh();
    } catch (e) { onNotice(e instanceof Error ? e.message : 'Save failed'); }
    setSaving(false);
  };
  const remove = async () => {
    if (!current) return;
    try { await api.deletePrompt(current.id); setCurrent(null); setDetailOpen(false); setConfirmDel(false); onNotice('Deleted'); await refresh(); }
    catch (e) { onNotice(e instanceof Error ? e.message : 'Delete failed'); }
  };
  const copy = async () => {
    if (!current) return;
    const ok = await copyText(current.content);
    if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 2200); } else onNotice('Copy was blocked: long-press the text and choose Copy.');
  };

  const shown = useMemo(() => { const n = q.trim().toLowerCase(); return n ? items.filter((i) => i.title.toLowerCase().includes(n) || i.preview.toLowerCase().includes(n)) : items; }, [items, q]);

  return <section className="doc-bleed w-full text-[var(--ink)]">
    <div className="flex items-center gap-2 px-4 py-2"><span className="text-xs text-[var(--ink-soft)]">{items.length} saved</span><button type="button" onClick={startNew} className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-amber-500 text-zinc-950" aria-label="New prompt"><Plus size={19} strokeWidth={2.6} /></button></div>

    {!persistent && <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-xs text-amber-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>Cloud storage is not ready, so prompts may not be saved. Run <code>supabase/schema.sql</code> in the Supabase SQL Editor.</span></div>}
    {error && <div className="border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-xs text-red-700">{error}</div>}

    <div className="grid min-h-[460px] md:h-[calc(100dvh-210px)] md:grid-cols-[320px_1fr]">
      {/* left: the list */}
      <aside className={`${detailOpen ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-[var(--line)] md:border-r`}>
        <div className="px-4 pb-2">
          <label className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-3 py-2 text-sm text-[var(--ink-soft)] focus-within:border-amber-500/50"><Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the vault" className="w-full bg-transparent text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]" /></label>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-[var(--line)] overflow-y-auto border-t border-[var(--line)]">
          {loading && <li className="p-4 text-center text-sm text-[var(--ink-soft)]">Loading…</li>}
          {!loading && shown.length === 0 && <li className="p-8 text-center text-sm text-[var(--ink-soft)]">{items.length ? 'No match.' : 'The vault is empty. Save your first Master Prompt.'}</li>}
          {shown.map((it) => <li key={it.id}><button type="button" onClick={() => open(it.id)}
            className={`w-full px-4 py-3 text-left transition ${current?.id === it.id && mode !== 'new' ? 'bg-amber-500/10' : 'hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]'}`}>
            <div className="truncate text-sm font-semibold text-[var(--ink)]">{it.title}</div>
            <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">{fmtDate(it.created_at)} · {it.chars.toLocaleString()} chars</div>
            <p className="mt-1.5 line-clamp-2 text-xs text-[var(--ink-soft)]">{it.preview}</p></button></li>)}
        </ul>
      </aside>

      {/* right: view / edit */}
      <div className={`${detailOpen ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-col`}>
        {mode === 'view' && !current && <div className="grid flex-1 place-items-center p-8 text-center text-[var(--ink-soft)]"><div><Library size={40} className="mx-auto mb-3 text-[var(--ink-soft)]" /><p className="text-sm">Pick a prompt on the left,<br />then press Copy once.</p></div></div>}

        {mode === 'view' && current && <>
          {/* sticky control bar: the Copy button never scrolls away */}
          <div className="sticky top-0 z-10 space-y-3 border-b border-[var(--line)] bg-[var(--paper)] p-4">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setDetailOpen(false)} className="rounded-lg p-2 text-[var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] md:hidden" aria-label="Back to list"><ArrowLeft size={18} /></button>
              <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">{current.title}</h3>
              <button type="button" onClick={startEdit} className="rounded-lg p-2 text-[var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-[var(--ink)]" aria-label="Edit"><Pencil size={16} /></button>
              {confirmDel
                ? <span className="flex items-center gap-1"><button type="button" onClick={remove} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white">Delete</button><button type="button" onClick={() => setConfirmDel(false)} className="rounded-lg p-2 text-[var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]" aria-label="Keep"><X size={15} /></button></span>
                : <button type="button" onClick={() => setConfirmDel(true)} className="rounded-lg p-2 text-[var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-red-600" aria-label="Delete"><Trash2 size={16} /></button>}
            </div>
            <button type="button" onClick={copy}
              className={`flex w-full items-center justify-center gap-3 rounded-xl px-6 py-4 text-lg font-extrabold tracking-wide text-zinc-950 transition active:scale-[.99] ${copied
                ? 'bg-gradient-to-r from-emerald-400 to-green-500 shadow-[0_0_40px_rgba(52,211,153,.55)]'
                : 'bg-gradient-to-r from-amber-300 to-orange-500 shadow-[0_0_36px_rgba(251,191,36,.45)] ring-2 ring-amber-300/40 hover:shadow-[0_0_50px_rgba(251,191,36,.7)]'}`}>
              {copied ? <><Check size={22} strokeWidth={3} /> Copied!</> : <><ClipboardCopy size={22} /> Copy Prompt</>}
            </button>
            <div className="text-[11px] text-[var(--ink-soft)]">{fmtDate(current.created_at)} · {current.content.length.toLocaleString()} characters · copies the entire text</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5"><pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-[var(--ink)]">{current.content}</pre></div>
        </>}

        {mode !== 'view' && <>
          <div className="flex items-center gap-2 border-b border-[var(--line)] p-4">
            <button type="button" onClick={cancel} className="rounded-lg p-2 text-[var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] md:hidden" aria-label="Back"><ArrowLeft size={18} /></button>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-[var(--amber-deep)]">{mode === 'new' ? 'Add to vault' : 'Edit prompt'}</h3>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Title, e.g. Master Prompt · Character sheet"
              className="w-full rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-4 py-3 text-base text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)] focus:border-amber-500/60" />
            <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Drop your massive prompt here…" spellCheck={false}
              className="min-h-[260px] w-full flex-1 resize-none rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-4 py-3 font-mono text-[13px] leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)] focus:border-amber-500/60" />
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--ink-soft)]">{content.length.toLocaleString()} / 400,000 characters</span>
              <button type="button" onClick={cancel} className="ml-auto rounded-lg px-4 py-2.5 text-sm text-[var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]">Cancel</button>
              <button type="button" onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-bold text-zinc-950 shadow-[0_0_24px_rgba(251,191,36,.3)] transition hover:bg-amber-400 disabled:opacity-60"><Save size={16} /> {saving ? 'Saving…' : 'Save to Vault'}</button>
            </div>
          </div>
        </>}
      </div>
    </div>
  </section>;
}
