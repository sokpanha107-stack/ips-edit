'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Archive, ArrowLeft, Check, CheckSquare, ChevronRight, DownloadCloud, File as FileIcon, FileArchive, FileAudio, FileVideo, Folder, FolderPlus, ImageIcon, LayoutGrid, List, Loader2, MoreVertical, Plus, Share2, Clapperboard, Trash2, Upload, X } from 'lucide-react';
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

function iconFor(d: Doc, size = 20) {
  if (d.kind === 'folder') return <Folder size={size} className="text-[var(--amber-deep)]" fill="currentColor" fillOpacity={0.18} />;
  if (d.kind === 'zip') return <FileArchive size={size} className="text-violet-700" />;
  if (d.mime?.startsWith('image/')) return <ImageIcon size={size} className="text-sky-700" />;
  if (d.mime?.startsWith('audio/')) return <FileAudio size={size} className="text-emerald-700" />;
  if (d.mime?.startsWith('video/')) return <FileVideo size={size} className="text-rose-700" />;
  return <FileIcon size={size} className="text-[var(--ink-soft)]" />;
}

interface ItemProps { d: Doc; view: 'grid' | 'list'; thumb?: string; selecting: boolean; selected: boolean; onToggle: () => void; onLong: () => void; onOpen: () => void; onMenu: () => void }
/** One file/folder as a grid tile or a flat list row. Long press (or Select) starts selection; tap toggles while selecting. */
function DocItem({ d, view, thumb, selecting, selected, onToggle, onLong, onOpen, onMenu }: ItemProps) {
  const lp = useLongPress(onLong);
  const tap = () => { if (lp.consumed()) return; if (selecting) onToggle(); else onOpen(); };
  const check = selecting && <span className={`absolute left-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full border ${selected ? 'border-amber-600 bg-amber-500 text-zinc-950' : 'border-[var(--ink-soft)] bg-[var(--paper)]/80'}`}>{selected && <Check size={12} strokeWidth={3} />}</span>;
  if (view === 'grid') {
    return <li className={`relative select-none rounded-xl p-1.5 [-webkit-touch-callout:none] ${selected ? 'bg-amber-500/20' : ''}`}>
      {check}
      <button type="button" {...lp.props} onClick={tap} className="block w-full text-center">
        <span className="mx-auto grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]">
          {thumb ? <img src={thumb} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" /> : iconFor(d, 40)}
        </span>
        <span className="mt-1.5 block truncate text-sm font-semibold leading-tight">{d.name}</span>
        <span className="block truncate text-xs text-[var(--ink-soft)]">{d.size_bytes ? fmtSize(d.size_bytes) : fmtDate(d.created_at)}</span>
      </button>
      {!selecting && <button type="button" onClick={onMenu} className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-[var(--paper)]/80 text-[var(--ink-soft)]" aria-label="More"><MoreVertical size={15} /></button>}
    </li>;
  }
  return <li className={`relative flex select-none items-center gap-3 px-4 py-2.5 [-webkit-touch-callout:none] ${selected ? 'bg-amber-500/15' : ''}`}>
    {selecting && <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${selected ? 'border-amber-600 bg-amber-500 text-zinc-950' : 'border-[var(--ink-soft)]'}`}>{selected && <Check size={12} strokeWidth={3} />}</span>}
    <button type="button" {...lp.props} className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={tap}>
      <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]">{thumb ? <img src={thumb} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" /> : iconFor(d, 22)}</span>
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{d.name}</span>
        <span className="block text-[11px] text-[var(--ink-soft)]">{fmtDate(d.created_at)}{d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ''}</span></span>
    </button>
    {!selecting && <button type="button" onClick={onMenu} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--ink-soft)]" aria-label="More"><MoreVertical size={17} /></button>}
  </li>;
}

/** Cloud-first file explorer. Bytes live in the private Supabase Storage bucket "documents"; nothing is kept on the device until you press Extract to ZIP. */
export function DocumentManager({ active, onNotice, onSendToTimeline, onSendMusic }: { active: boolean; onNotice: (m: string) => void; onSendToTimeline?: (files: File[]) => Promise<void> | void; onSendMusic?: (f: File) => Promise<void> | void }) {
  const sb = browserClient();
  const [trail, setTrail] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'All files' }]);
  const [items, setItems] = useState<Doc[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [bulkAsk, setBulkAsk] = useState(false);       // "Delete N selected?" confirmation
  const [newName, setNewName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState<File[] | null>(null);   // prepared for the native share sheet
  const cwd = trail[trail.length - 1];
  const [view, setViewState] = useState<'grid' | 'list'>('grid');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<Doc | null>(null);
  const [plus, setPlus] = useState(false);
  useEffect(() => { try { if (window.localStorage.getItem('ips-doc-view') === 'list') setViewState('list'); } catch { /* storage unavailable */ } }, []);
  const setView = (v: 'grid' | 'list') => { setViewState(v); try { window.localStorage.setItem('ips-doc-view', v); } catch { /* storage unavailable */ } };

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

  const [listen, setListen] = useState<{ doc: Doc; url: string } | null>(null);   // inline player for .mp3 (e.g. Music Engine songs)
  const openFile = async (d: Doc) => {
    if (!d.storage_path) return;
    if (d.mime?.startsWith('audio/')) {
      const r = await sb.storage.from(BUCKET).createSignedUrl(d.storage_path, 3600);
      if (r.error || !r.data) onNotice(r.error?.message ?? 'Could not open'); else setListen({ doc: d, url: r.data.signedUrl });
      return;
    }
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

  /** Deletes every selected file/folder from the cloud (Storage objects first, then the rows) and from the screen. */
  const removeSelected = async () => {
    const chosen = shown.filter((d) => picked.has(d.id));
    setBulkAsk(false); if (!chosen.length) return;
    setBusy(`Deleting ${chosen.length}…`);
    try {
      const paths: string[] = [];
      for (const d of chosen) {
        if (d.kind === 'folder') paths.push(...(await collect(d.id, '')).map((f) => f.doc.storage_path!).filter(Boolean));
        else if (d.storage_path) paths.push(d.storage_path);
      }
      for (let i = 0; i < paths.length; i += 100) { const r = await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100)); if (r.error) throw new Error(r.error.message); }
      const ids = chosen.map((d) => d.id);
      for (let i = 0; i < ids.length; i += 100) { const { error } = await sb.from('documents').delete().in('id', ids.slice(i, i + 100)); if (error) throw new Error(error.message); }
      onNotice(`Deleted ${chosen.length} item${chosen.length > 1 ? 's' : ''}`);
      exitSelect();
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
  const allPicked = shown.length > 0 && shown.every((d) => picked.has(d.id));
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(shown.map((d) => d.id)));

  // Image thumbnails: signed URLs for the images in this folder (first 80).
  useEffect(() => {
    const imgs = items.filter((d) => d.storage_path && d.mime?.startsWith('image/')).slice(0, 80);
    if (!imgs.length) { setThumbs({}); return; }
    let live = true;
    void sb.storage.from(BUCKET).createSignedUrls(imgs.map((d) => d.storage_path!), 900).then(({ data }) => {
      if (!live || !data) return;
      const m: Record<string, string> = {};
      data.forEach((r, i) => { if (r.signedUrl) m[imgs[i].id] = r.signedUrl; });
      setThumbs(m);
    });
    return () => { live = false; };
  }, [items, sb]);

  const iconBtn = 'grid h-9 w-9 place-items-center rounded-full text-[var(--ink)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]';
  return <section className="doc-bleed w-full text-[var(--ink)]">
    <header className="relative flex items-center gap-1 px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        {trail.length > 1 && <button type="button" onClick={() => setTrail((t) => t.slice(0, -1))} className={iconBtn} aria-label="Back"><ArrowLeft size={18} /></button>}
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap">
          {trail.map((c, i) => <span key={`${c.id}-${i}`} className="flex items-center gap-1 text-[var(--ink-soft)]">{i > 0 && <ChevronRight size={13} />}<button type="button" onClick={() => setTrail((t) => t.slice(0, i + 1))} className={i === trail.length - 1 ? 'font-semibold text-[var(--ink)]' : ''}>{c.name}</button></span>)}
        </div>
      </div>
      {selecting
        ? <><span className="text-xs font-semibold text-[var(--ink-soft)]">{picked.size}</span>
            <button type="button" onClick={toggleAll} className="rounded-full px-3 py-1.5 text-xs font-bold text-[var(--amber-deep)]">{allPicked ? 'Clear' : 'Select all'}</button>
            <button type="button" onClick={exitSelect} className={iconBtn} aria-label="Done"><X size={18} /></button></>
        : <>
            <button type="button" onClick={() => setView(view === 'grid' ? 'list' : 'grid')} className={iconBtn} aria-label={view === 'grid' ? 'List view' : 'Grid view'}>{view === 'grid' ? <List size={18} /> : <LayoutGrid size={18} />}</button>
            <button type="button" onClick={() => setSelecting(true)} className={iconBtn} aria-label="Select"><CheckSquare size={18} /></button>
            <button type="button" onClick={() => setPlus((v) => !v)} className="grid h-9 w-9 place-items-center rounded-full bg-amber-500 text-zinc-950" aria-label="Add" aria-expanded={plus}><Plus size={19} strokeWidth={2.6} /></button>
          </>}
      {plus && <><div className="fixed inset-0 z-20" onClick={() => setPlus(false)} />
        <div className="absolute right-3 top-12 z-30 w-44 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)] text-sm shadow-[0_12px_30px_rgba(30,41,59,.25)]">
          <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left" onClick={() => { setPlus(false); setNewName(''); }}><FolderPlus size={16} /> New folder</button>
          <button type="button" className="flex w-full items-center gap-2 border-t border-[var(--line)] px-4 py-3 text-left" onClick={() => { setPlus(false); fileRef.current?.click(); }}><Upload size={16} /> Upload files</button>
        </div></>}
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
    </header>

    <div className="flex gap-1 px-3 pb-2 text-xs">
      {([['all', 'All'], ['folder', 'Projects'], ['zip', 'ZIPs']] as [Filter, string][]).map(([k, l]) => <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 ${filter === k ? 'bg-[color-mix(in_srgb,var(--ink)_12%,transparent)] font-semibold text-[var(--ink)]' : 'text-[var(--ink-soft)]'}`}>{l}</button>)}
    </div>

    {busy && <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-700"><Loader2 size={14} className="animate-spin" /> {busy}</div>}
    {newName !== null && <form className="flex gap-2 px-3 pb-3" onSubmit={(e) => { e.preventDefault(); void createFolder(); }}>
      <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} placeholder="Folder name" className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-3 py-2 text-sm outline-none focus:border-amber-500/60" />
      <button type="submit" className="rounded-lg bg-amber-500 px-4 text-sm font-bold text-zinc-950">Create</button>
      <button type="button" onClick={() => setNewName(null)} className="rounded-lg px-3 text-sm text-[var(--ink-soft)]">Cancel</button>
    </form>}

    <ul className={`${selecting ? 'pb-32 ' : 'pb-6 '}min-h-[260px] ${view === 'grid' ? 'grid grid-cols-3 gap-1 px-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7' : 'divide-y divide-[var(--line)]'}`}>
      {loading && <li className="col-span-full p-8 text-center text-sm text-[var(--ink-soft)]">Loading…</li>}
      {!loading && !shown.length && <li className="col-span-full p-10 text-center text-sm text-[var(--ink-soft)]">Nothing here yet. Finished image, voice and video jobs appear as folders automatically.</li>}
      {shown.map((d) => <DocItem key={d.id} d={d} view={view} thumb={thumbs[d.id]} selecting={selecting} selected={picked.has(d.id)}
        onToggle={() => toggle(d.id)} onLong={() => beginSelect(d.id)} onMenu={() => { setConfirm(null); setMenu(d); }}
        onOpen={() => (d.kind === 'folder' ? setTrail((t) => [...t, { id: d.id, name: d.name }]) : void openFile(d))} />)}
    </ul>

    {menu && <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30" onClick={() => setMenu(null)}>
      <div className="w-full max-w-md rounded-t-2xl bg-[var(--paper)] p-3 pb-[calc(12px+env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(30,41,59,.3)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-2 py-2">{iconFor(menu, 22)}<span className="truncate text-sm font-semibold">{menu.name}</span></div>
        {menu.kind === 'folder' && <>
          <button type="button" disabled={!!busy} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm" onClick={() => { const d = menu; setMenu(null); void extract(d); }}><DownloadCloud size={18} /> Extract to ZIP (save on device)</button>
          <button type="button" disabled={!!busy} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm" onClick={() => { const d = menu; setMenu(null); void archiveToCloud(d); }}><Archive size={18} /> Save ZIP to cloud</button>
        </>}
        <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm" onClick={() => { const d = menu; setMenu(null); beginSelect(d.id); }}><CheckSquare size={18} /> Select</button>
        {confirm === menu.id
          ? <div className="flex gap-2 px-1 pt-1"><button type="button" onClick={() => { const d = menu; setMenu(null); void remove(d); }} className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white">Confirm delete</button><button type="button" onClick={() => setConfirm(null)} className="rounded-xl px-4 py-3 text-sm text-[var(--ink-soft)]">Cancel</button></div>
          : <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-red-600" onClick={() => setConfirm(menu.id)}><Trash2 size={18} /> Delete</button>}
      </div>
    </div>}

    {listen && <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 px-6" onMouseDown={() => setListen(null)}>
      <div role="dialog" aria-label={listen.doc.name} className="w-full max-w-sm rounded-2xl bg-[var(--paper)] p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="truncate text-base font-bold">{listen.doc.name}</h3>
        <audio controls autoPlay src={listen.url} className="mt-3 w-full" />
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={listen.url} download={listen.doc.name} className="flex-1 rounded-xl border border-[var(--line)] py-3 text-center text-sm font-semibold">Download .mp3</a>
          {onSendMusic && <button type="button" className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-bold text-white" onClick={async () => { const r = await sb.storage.from(BUCKET).download(listen.doc.storage_path!); if (r.error || !r.data) { onNotice(r.error?.message ?? 'Download failed'); return; } setListen(null); await onSendMusic(new File([r.data], listen.doc.name, { type: 'audio/mpeg' })); }}>Send to Timeline</button>}
        </div>
        <button type="button" className="mt-2 w-full py-2 text-sm text-[var(--ink-soft)]" onClick={() => setListen(null)}>Close</button>
      </div>
    </div>}

    {bulkAsk && <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 px-6" onMouseDown={() => setBulkAsk(false)}>
      <div role="alertdialog" aria-label="Delete selected" className="w-full max-w-sm rounded-2xl bg-[var(--paper)] p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold">Delete {picked.size} selected item{picked.size > 1 ? 's' : ''}?</h3>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">They are removed from your cloud storage for good. Folders are deleted with every file inside. This cannot be undone.</p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => setBulkAsk(false)} className="flex-1 rounded-xl border border-[var(--line)] py-3 text-sm font-semibold">Cancel</button>
          <button type="button" onClick={() => void removeSelected()} className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white">Delete {picked.size}</button>
        </div>
      </div>
    </div>}

    {selecting && <div className="fixed inset-x-3 bottom-3 z-30 mx-auto max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 shadow-[0_12px_40px_rgba(30,41,59,.28)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs font-semibold text-[var(--ink-soft)]">{picked.size} selected</span>
        {ready
          ? <button type="button" onClick={() => void shareNow()} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"><Share2 size={16} /> Tap to share {ready.length} file{ready.length > 1 ? 's' : ''}</button>
          : <>
            {onSendToTimeline && <button type="button" onClick={() => void sendToTimeline()} disabled={!picked.size || !!busy} className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-zinc-950 disabled:opacity-50"><Clapperboard size={16} /> Send to Timeline</button>}
            <button type="button" onClick={() => void prepareShare()} disabled={!picked.size || !!busy} className="flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"><Share2 size={16} /> Share / Export</button>
            <button type="button" onClick={() => setBulkAsk(true)} disabled={!picked.size || !!busy} className="flex items-center gap-2 rounded-xl border border-red-500/50 px-4 py-2.5 text-sm font-semibold text-red-600 disabled:opacity-50"><Trash2 size={16} /> Delete</button>
          </>}
        <button type="button" onClick={exitSelect} className="grid h-10 w-10 place-items-center rounded-xl text-[var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]" aria-label="Cancel selection"><X size={18} /></button>
      </div>
    </div>}
  </section>;
}
