'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Archive, ArrowLeft, Check, CheckSquare, ChevronRight, DownloadCloud, File as FileIcon, FileArchive, FileAudio, FileVideo, Folder, FolderPlus, ImageIcon, Loader2, Share2, Clapperboard, Trash2, Upload, X } from 'lucide-react';
import { browserClient } from '@/lib/supabase/browser';
import { naturalCompare, sortByName } from '@/lib/client/natural';
import { useLongPress } from '@/hooks/use-long-press';

interface Doc { id: string; parent_id: string | null; kind: 'folder' | 'file' | 'zip'; name: string; storage_path: string | null; mime: string | null; size_bytes: number; source: string | null; created_at: string }
type Filter = 'all' | 'folder' | 'zip';
const BUCKET = 'documents';
const COLS = 'id,parent_id,kind,name,storage_path,mime,size_bytes,source,created_at';
const fmtSize = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : n ? `${n} B` : '');
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const safe = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';

function iconFor(d: Doc) {
  if (d.kind === 'folder') return <Folder size={20} className="text-[var(--amber-deep)]" />;
  if (d.kind === 'zip') return <FileArchive size={20} className="text-violet-700" />;
  if (d.mime?.startsWith('image/')) return <ImageIcon size={20} className="text-sky-700" />;
  if (d.mime?.startsWith('audio/')) return <FileAudio size={20} className="text-emerald-700" />;
  if (d.mime?.startsWith('video/')) return <FileVideo size={20} className="text-rose-700" />;
  return <FileIcon size={20} className="text-[var(--ink-soft)]" />;
}


interface RowProps { d: Doc; selecting: boolean; selected: boolean; busy: boolean; confirming: boolean; onToggle: () => void; onLong: () => void; onOpen: () => void; onExtract: () => void; onArchive: () => void; onAskDelete: () => void; onDelete: () => void; onCancelDelete: () => void }
/** One file/folder row. Long press (or the Select button) starts selection; tap toggles while selecting. */
function DocRow({ d, selecting, selected, busy, confirming, onToggle, onLong, onOpen, onExtract, onArchive, onAskDelete, onDelete, onCancelDelete }: RowProps) {
  const lp = useLongPress(onLong);
  return <li className={`flex select-none items-center gap-3 px-5 py-3 [-webkit-touch-callout:none] ${selected ? 'bg-amber-500/15' : 'hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]'}`}>
    {selecting && <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${selected ? 'border-amber-600 bg-amber-500 text-zinc-950' : 'border-[var(--ink-soft)]'}`}>{selected && <Check size={13} strokeWidth={3} />}</span>}
    <button type="button" {...lp.props} className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => { if (lp.consumed()) return; if (selecting) onToggle(); else onOpen(); }}>
      {iconFor(d)}
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{d.name}</span>
        <span className="block text-[11px] text-[var(--ink-soft)]">{fmtDate(d.created_at)}{d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ''}{d.source && d.source !== 'upload' ? ` · ${d.source}` : ''}</span></span>
    </button>
    {!selecting && <>
      {d.kind === 'folder' && <>
        <button type="button" onClick={onExtract} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-[var(--amber-deep)] hover:bg-amber-500/20 disabled:opacity-50"><DownloadCloud size={14} /><span className="hidden sm:inline">Extract to ZIP</span></button>
        <button type="button" onClick={onArchive} disabled={busy} className="rounded-lg p-2 text-[var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-[var(--ink)] disabled:opacity-50" aria-label="Save ZIP in cloud" title="Save a ZIP copy in the cloud"><Archive size={16} /></button>
      </>}
      {confirming
        ? <span className="flex items-center gap-1"><button type="button" onClick={onDelete} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white">Delete</button><button type="button" onClick={onCancelDelete} className="px-2 text-xs text-[var(--ink-soft)]">No</button></span>
        : <button type="button" onClick={onAskDelete} className="rounded-lg p-2 text-[var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-red-600" aria-label="Delete"><Trash2 size={16} /></button>}
    </>}
  </li>;
}

/** Cloud-first file explorer. Bytes live in the private Supabase Storage bucket "documents"; nothing is kept on the device until you press Extract to ZIP. */
export function DocumentManager({ active, onNotice, onSendToTimeline }: { active: boolean; onNotice: (m: string) => void; onSendToTimeline?: (files: File[]) => Promise<void> | void }) {
  const sb = browserClient();
  const [trail, setTrail] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'All files' }]);
  const [items, setItems] = useState<Doc[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState<File[] | null>(null);   // prepared for the native share sheet
  const cwd = trail[trail.length - 1];

  const load = useCallback(async () => {
    setLoading(true);
    let q = sb.from('documents').select(COLS).order('name', { ascending: true }).limit(1000);
    q = cwd.id ? q.eq('parent_id', cwd.id) : q.is('parent_id', null);
    const { data, error } = await q;
    if (error) onNotice(error.message);
    setItems(sortByName((data ?? []) as Doc[])); setLoading(false);
  }, [sb, cwd.id, onNotice]);
  useEffect(() => { if (active) void load(); }, [active, load]);

  const uid = async () => (await sb.auth.getUser()).data.user?.id ?? '';

  const createFolder = async () => {
    const name = (newName ?? '').trim(); if (!name) { setNewName(null); return; }
    const { error } = await sb.from('documents').insert({ user_id: await uid(), parent_id: cwd.id, kind: 'folder', name: safe(name) });
    setNewName(null); if (error) onNotice(error.message); else void load();
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const user = await uid(); let ok = 0;
    for (const f of Array.from(files)) {
      setBusy(`Uploading ${f.name}…`);
      const path = `${user}/${cwd.id ?? 'root'}/${crypto.randomUUID().slice(0, 8)}-${safe(f.name)}`;
      const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined });
      if (up.error) { onNotice(up.error.message); continue; }
      const isZip = /\.zip$/i.test(f.name) || f.type === 'application/zip';
      const ins = await sb.from('documents').insert({ user_id: user, parent_id: cwd.id, kind: isZip ? 'zip' : 'file', name: safe(f.name), storage_path: path, mime: f.type || null, size_bytes: f.size, source: 'upload' });
      if (ins.error) { await sb.storage.from(BUCKET).remove([path]); onNotice(ins.error.message); } else ok += 1;
    }
    setBusy(''); if (fileRef.current) fileRef.current.value = '';
    if (ok) onNotice(`${ok} file${ok > 1 ? 's' : ''} uploaded`);
    void load();
  };

  const openFile = async (d: Doc) => {
    if (!d.storage_path) return;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.storage_path, 300, { download: d.kind === 'zip' ? d.name : undefined });
    if (error || !data) onNotice(error?.message ?? 'Could not open'); else window.open(data.signedUrl, '_blank', 'noopener');
  };

  /** Every file below a folder, with its folder path inside the ZIP. */
  const collect = async (folderId: string, prefix: string): Promise<{ zipPath: string; doc: Doc }[]> => {
    const { data, error } = await sb.from('documents').select(COLS).eq('parent_id', folderId);
    if (error) throw new Error(error.message);
    const out: { zipPath: string; doc: Doc }[] = [];
    for (const d of sortByName((data ?? []) as Doc[])) {
      if (d.kind === 'folder') out.push(...(await collect(d.id, `${prefix}${d.name}/`)));
      else if (d.storage_path) out.push({ zipPath: `${prefix}${d.name}`, doc: d });
    }
    return out;
  };

  /** Packages the folder's cloud files into one ZIP, in the browser. */
  const buildZip = async (folder: Doc): Promise<Blob> => {
    const files = await collect(folder.id, '');
    if (!files.length) throw new Error('This folder has no files.');
    const zip = new JSZip(); const used = new Set<string>();
    for (let i = 0; i < files.length; i++) {
      setBusy(`Downloading ${i + 1}/${files.length}…`);
      const { data, error } = await sb.storage.from(BUCKET).download(files[i].doc.storage_path!);
      if (error || !data) throw new Error(`Could not read ${files[i].doc.name}`);
      let p = files[i].zipPath; if (used.has(p)) p = p.replace(/(\.[^./]+)?$/, `-${i + 1}$1`); used.add(p);
      zip.file(p, data);
    }
    return zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => setBusy(`Packing ZIP ${Math.round(m.percent)}%`));
  };

  const extract = async (folder: Doc) => {
    try {
      const blob = await buildZip(folder);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${safe(folder.name)}.zip`;
      document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      onNotice('ZIP saved to this device');
    } catch (e) { onNotice(e instanceof Error ? e.message : 'ZIP failed'); }
    setBusy('');
  };

  const archiveToCloud = async (folder: Doc) => {
    try {
      const blob = await buildZip(folder); const user = await uid();
      setBusy('Saving ZIP to cloud…');
      const path = `${user}/zips/${crypto.randomUUID().slice(0, 8)}-${safe(folder.name)}.zip`;
      const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'application/zip' });
      if (up.error) throw new Error(up.error.message);
      const ins = await sb.from('documents').insert({ user_id: user, parent_id: null, kind: 'zip', name: `${safe(folder.name)}.zip`, storage_path: path, mime: 'application/zip', size_bytes: blob.size, source: 'upload' });
      if (ins.error) throw new Error(ins.error.message);
      onNotice('ZIP archived in the cloud'); if (!cwd.id) void load();
    } catch (e) { onNotice(e instanceof Error ? e.message : 'Archive failed'); }
    setBusy('');
  };

  const remove = async (d: Doc) => {
    setConfirm(null); setBusy('Deleting…');
    try {
      const paths = d.kind === 'folder' ? (await collect(d.id, '')).map((f) => f.doc.storage_path!) : d.storage_path ? [d.storage_path] : [];
      for (let i = 0; i < paths.length; i += 100) { const r = await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100)); if (r.error) throw new Error(r.error.message); }
      const { error } = await sb.from('documents').delete().eq('id', d.id);
      if (error) throw new Error(error.message);
    } catch (e) { onNotice(e instanceof Error ? e.message : 'Delete failed'); }
    setBusy(''); void load();
  };

  /* ---- selection, send to Timeline, share */
  const exitSelect = () => { setSelecting(false); setPicked(new Set()); setReady(null); };
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); if (!n.size) { setSelecting(false); setReady(null); } return n; });
  const beginSelect = (id: string) => { setSelecting(true); setReady(null); setPicked((p) => new Set(p).add(id)); };

  /** The chosen files (folders expand to their files), always in strict natural name order. */
  const chosenFiles = async (): Promise<File[]> => {
    const docs = items.filter((d) => picked.has(d.id));
    const flat: { key: string; doc: Doc }[] = [];
    for (const d of docs) { if (d.kind === 'folder') flat.push(...(await collect(d.id, '')).map((f) => ({ key: f.zipPath, doc: f.doc }))); else if (d.storage_path) flat.push({ key: d.name, doc: d }); }
    if (!flat.length) throw new Error('No files in the selection.');
    flat.sort((a, b) => naturalCompare(a.key, b.key));
    const out: File[] = [];
    for (let i = 0; i < flat.length; i++) {
      setBusy(`Preparing ${i + 1}/${flat.length}…`);
      const { data, error } = await sb.storage.from(BUCKET).download(flat[i].doc.storage_path!);
      if (error || !data) throw new Error(`Could not read ${flat[i].doc.name}`);
      out.push(new File([data], flat[i].doc.name, { type: flat[i].doc.mime || data.type || '' }));
    }
    return out;
  };
  const sendToTimeline = async () => {
    if (!onSendToTimeline) return;
    try { const files = await chosenFiles(); setBusy(''); await onSendToTimeline(files); exitSelect(); }
    catch (e) { onNotice(e instanceof Error ? e.message : 'Could not send'); }
    setBusy('');
  };
  const prepareShare = async () => {
    try { setReady(await chosenFiles()); } catch (e) { onNotice(e instanceof Error ? e.message : 'Could not prepare files'); }
    setBusy('');
  };
  /** Runs inside a fresh tap, which iOS Safari requires for the share sheet. Falls back to saving the files. */
  const shareNow = async () => {
    if (!ready) return;
    try {
      if (navigator.canShare?.({ files: ready })) { await navigator.share({ files: ready, title: ready.length === 1 ? ready[0].name : `${ready.length} files` }); exitSelect(); return; }
      for (const f of ready) { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000); }
      onNotice('Sharing is not supported here, so the files were saved to this device.'); exitSelect();
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) onNotice(e instanceof Error ? e.message : 'Share failed'); }
  };

  const shown = items.filter((d) => filter === 'all' || d.kind === filter);

  return <section className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] shadow-[0_18px_50px_rgba(30,41,59,.12)]">
    <header className="flex flex-wrap items-center justify-end gap-2 border-b border-[var(--line)] px-5 py-3">
      <button type="button" onClick={() => (selecting ? exitSelect() : setSelecting(true))} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${selecting ? 'border-amber-600 bg-amber-500/15 text-[var(--amber-deep)]' : 'border-[var(--line)] text-[var(--ink)] hover:border-[var(--amber-deep)]'}`}><CheckSquare size={14} /> {selecting ? 'Done' : 'Select'}</button>
      <button type="button" onClick={() => setNewName('')} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--ink)] hover:border-[var(--amber-deep)]"><FolderPlus size={14} /> New folder</button>
      <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400"><Upload size={14} /> Upload</button>
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
    </header>

    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-5 py-2.5 text-sm">
      {trail.length > 1 && <button type="button" onClick={() => setTrail((t) => t.slice(0, -1))} className="rounded-md p-1 text-[var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]" aria-label="Back"><ArrowLeft size={16} /></button>}
      {trail.map((c, i) => <span key={`${c.id}-${i}`} className="flex items-center gap-1 text-[var(--ink-soft)]">{i > 0 && <ChevronRight size={13} />}<button type="button" onClick={() => setTrail((t) => t.slice(0, i + 1))} className={i === trail.length - 1 ? 'font-semibold text-[var(--ink)]' : 'hover:text-[var(--ink)]'}>{c.name}</button></span>)}
      <div className="ml-auto flex gap-1 rounded-lg border border-[var(--line)] p-0.5 text-xs">
        {([['all', 'All'], ['folder', 'Projects'], ['zip', 'ZIPs']] as [Filter, string][]).map(([k, l]) => <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 ${filter === k ? 'bg-[color-mix(in_srgb,var(--ink)_12%,transparent)] text-[var(--ink)]' : 'text-[var(--ink-soft)] hover:text-[var(--ink)]'}`}>{l}</button>)}
      </div>
    </div>

    {busy && <div className="flex items-center gap-2 border-b border-sky-500/20 bg-sky-500/10 px-5 py-2 text-xs text-sky-700"><Loader2 size={14} className="animate-spin" /> {busy}</div>}
    {newName !== null && <form className="flex gap-2 border-b border-[var(--line)] px-5 py-3" onSubmit={(e) => { e.preventDefault(); void createFolder(); }}>
      <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} placeholder="Folder name" className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-3 py-2 text-sm outline-none focus:border-amber-500/60" />
      <button type="submit" className="rounded-lg bg-amber-500 px-4 text-sm font-bold text-zinc-950">Create</button>
      <button type="button" onClick={() => setNewName(null)} className="rounded-lg px-3 text-sm text-[var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]">Cancel</button>
    </form>}

    <ul className={`${selecting ? "pb-32 " : ""}max-h-[calc(100dvh-250px)] min-h-[260px] divide-y divide-[var(--line)] overflow-y-auto`}>
      {loading && <li className="p-8 text-center text-sm text-[var(--ink-soft)]">Loading…</li>}
      {!loading && !shown.length && <li className="p-10 text-center text-sm text-[var(--ink-soft)]">Nothing here yet. Finished image, voice and video jobs appear as folders automatically.</li>}
      {shown.map((d) => <DocRow key={d.id} d={d} selecting={selecting} selected={picked.has(d.id)} busy={!!busy} confirming={confirm === d.id}
        onToggle={() => toggle(d.id)} onLong={() => beginSelect(d.id)}
        onOpen={() => (d.kind === 'folder' ? setTrail((t) => [...t, { id: d.id, name: d.name }]) : void openFile(d))}
        onExtract={() => void extract(d)} onArchive={() => void archiveToCloud(d)} onAskDelete={() => setConfirm(d.id)} onDelete={() => void remove(d)} onCancelDelete={() => setConfirm(null)} />)}
    </ul>
    {selecting && <div className="fixed inset-x-3 bottom-3 z-30 mx-auto max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 shadow-[0_12px_40px_rgba(30,41,59,.28)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs font-semibold text-[var(--ink-soft)]">{picked.size} selected</span>
        {ready
          ? <button type="button" onClick={() => void shareNow()} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"><Share2 size={16} /> Tap to share {ready.length} file{ready.length > 1 ? 's' : ''}</button>
          : <>
            {onSendToTimeline && <button type="button" onClick={() => void sendToTimeline()} disabled={!picked.size || !!busy} className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-zinc-950 disabled:opacity-50"><Clapperboard size={16} /> Send to Timeline</button>}
            <button type="button" onClick={() => void prepareShare()} disabled={!picked.size || !!busy} className="flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"><Share2 size={16} /> Share / Export</button>
          </>}
        <button type="button" onClick={exitSelect} className="grid h-10 w-10 place-items-center rounded-xl text-[var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]" aria-label="Cancel selection"><X size={18} /></button>
      </div>
    </div>}
  </section>;
}
