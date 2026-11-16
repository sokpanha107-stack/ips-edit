'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Archive, ArrowLeft, ChevronRight, Cloud, DownloadCloud, File as FileIcon, FileArchive, FileAudio, FileVideo, Folder, FolderPlus, ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { browserClient } from '@/lib/supabase/browser';

interface Doc { id: string; parent_id: string | null; kind: 'folder' | 'file' | 'zip'; name: string; storage_path: string | null; mime: string | null; size_bytes: number; source: string | null; created_at: string }
type Filter = 'all' | 'folder' | 'zip';
const BUCKET = 'documents';
const COLS = 'id,parent_id,kind,name,storage_path,mime,size_bytes,source,created_at';
const fmtSize = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : n ? `${n} B` : '');
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const safe = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';

function iconFor(d: Doc) {
  if (d.kind === 'folder') return <Folder size={20} className="text-amber-400" />;
  if (d.kind === 'zip') return <FileArchive size={20} className="text-violet-400" />;
  if (d.mime?.startsWith('image/')) return <ImageIcon size={20} className="text-sky-400" />;
  if (d.mime?.startsWith('audio/')) return <FileAudio size={20} className="text-emerald-400" />;
  if (d.mime?.startsWith('video/')) return <FileVideo size={20} className="text-rose-400" />;
  return <FileIcon size={20} className="text-zinc-400" />;
}

/** Cloud-first file explorer. Bytes live in the private Supabase Storage bucket "documents"; nothing is kept on the device until you press Extract to ZIP. */
export function DocumentManager({ active, onNotice }: { active: boolean; onNotice: (m: string) => void }) {
  const sb = browserClient();
  const [trail, setTrail] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'Document' }]);
  const [items, setItems] = useState<Doc[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cwd = trail[trail.length - 1];

  const load = useCallback(async () => {
    setLoading(true);
    let q = sb.from('documents').select(COLS).order('created_at', { ascending: false }).limit(500);
    q = cwd.id ? q.eq('parent_id', cwd.id) : q.is('parent_id', null);
    const { data, error } = await q;
    if (error) onNotice(error.message);
    const rows = (data ?? []) as Doc[];
    rows.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder'));
    setItems(rows); setLoading(false);
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
    for (const d of (data ?? []) as Doc[]) {
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

  const shown = items.filter((d) => filter === 'all' || d.kind === filter);

  return <section className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl shadow-black/40">
    <header className="flex items-center gap-3 border-b border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-950 px-5 py-3">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30"><Cloud size={18} /></span>
      <div className="min-w-0"><div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-sky-400/80">Cloud storage</div><h2 className="truncate text-base font-semibold">Document</h2></div>
      <div className="ml-auto flex gap-2">
        <button type="button" onClick={() => setNewName('')} className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-amber-500/50"><FolderPlus size={14} /> New folder</button>
        <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400"><Upload size={14} /> Upload</button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
      </div>
    </header>

    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-5 py-2.5 text-sm">
      {trail.length > 1 && <button type="button" onClick={() => setTrail((t) => t.slice(0, -1))} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-900" aria-label="Back"><ArrowLeft size={16} /></button>}
      {trail.map((c, i) => <span key={`${c.id}-${i}`} className="flex items-center gap-1 text-zinc-400">{i > 0 && <ChevronRight size={13} />}<button type="button" onClick={() => setTrail((t) => t.slice(0, i + 1))} className={i === trail.length - 1 ? 'font-semibold text-zinc-100' : 'hover:text-zinc-200'}>{c.name}</button></span>)}
      <div className="ml-auto flex gap-1 rounded-lg border border-zinc-800 p-0.5 text-xs">
        {([['all', 'All'], ['folder', 'Projects'], ['zip', 'ZIPs']] as [Filter, string][]).map(([k, l]) => <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 ${filter === k ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>{l}</button>)}
      </div>
    </div>

    {busy && <div className="flex items-center gap-2 border-b border-sky-500/20 bg-sky-500/10 px-5 py-2 text-xs text-sky-300"><Loader2 size={14} className="animate-spin" /> {busy}</div>}
    {newName !== null && <form className="flex gap-2 border-b border-zinc-800 px-5 py-3" onSubmit={(e) => { e.preventDefault(); void createFolder(); }}>
      <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} placeholder="Folder name" className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-amber-500/60" />
      <button type="submit" className="rounded-lg bg-amber-500 px-4 text-sm font-bold text-zinc-950">Create</button>
      <button type="button" onClick={() => setNewName(null)} className="rounded-lg px-3 text-sm text-zinc-400 hover:bg-zinc-900">Cancel</button>
    </form>}

    <ul className="max-h-[calc(100dvh-300px)] min-h-[260px] divide-y divide-zinc-900 overflow-y-auto">
      {loading && <li className="p-8 text-center text-sm text-zinc-500">Loading…</li>}
      {!loading && !shown.length && <li className="p-10 text-center text-sm text-zinc-500">Nothing here yet. Finished image, voice and video jobs appear as folders automatically.</li>}
      {shown.map((d) => <li key={d.id} className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-900/60">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => (d.kind === 'folder' ? setTrail((t) => [...t, { id: d.id, name: d.name }]) : void openFile(d))}>
          {iconFor(d)}
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{d.name}</span>
            <span className="block text-[11px] text-zinc-500">{fmtDate(d.created_at)}{d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ''}{d.source && d.source !== 'upload' ? ` · ${d.source}` : ''}</span></span>
        </button>
        {d.kind === 'folder' && <>
          <button type="button" onClick={() => void extract(d)} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"><DownloadCloud size={14} /><span className="hidden sm:inline">Extract to ZIP</span></button>
          <button type="button" onClick={() => void archiveToCloud(d)} disabled={!!busy} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-50" aria-label="Save ZIP in cloud" title="Save a ZIP copy in the cloud"><Archive size={16} /></button>
        </>}
        {confirm === d.id
          ? <span className="flex items-center gap-1"><button type="button" onClick={() => void remove(d)} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white">Delete</button><button type="button" onClick={() => setConfirm(null)} className="px-2 text-xs text-zinc-400">No</button></span>
          : <button type="button" onClick={() => setConfirm(d.id)} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-red-400" aria-label="Delete"><Trash2 size={16} /></button>}
      </li>)}
    </ul>
  </section>;
}
