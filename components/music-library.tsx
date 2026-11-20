'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clapperboard, Music2, Pause, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { addMusic, deleteMusic, getMusicBlob, listMusic, renameMusic, type MusicMeta } from '@/lib/client/musicStore';

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Browse and manage background music tracks; one tap sends a track to the Timeline background lane. */
export function MusicLibrary({ onNotice, onUse }: { onNotice: (m: string) => void; onUse: (f: File) => void }) {
  const [tracks, setTracks] = useState<MusicMeta[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const [ask, setAsk] = useState<MusicMeta | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const load = useCallback(async () => { try { setTracks(await listMusic()); } catch { onNotice('Music storage is unavailable.'); } }, [onNotice]);
  useEffect(() => { void load(); return () => audio.current?.pause(); }, [load]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return; let n = 0;
    for (const f of Array.from(files)) { try { await addMusic(f); n += 1; } catch (e) { onNotice(e instanceof Error ? e.message : 'Failed'); } }
    if (n) onNotice(`${n} track${n > 1 ? 's' : ''} added`); void load();
  };
  const play = async (m: MusicMeta) => {
    audio.current?.pause();
    if (playing === m.id) { setPlaying(null); return; }
    const blob = await getMusicBlob(m.id); if (!blob) return;
    const a = new Audio(URL.createObjectURL(blob)); audio.current = a; a.onended = () => setPlaying(null);
    setPlaying(m.id); await a.play().catch(() => setPlaying(null));
  };
  const use = async (m: MusicMeta) => { const b = await getMusicBlob(m.id); if (b) onUse(new File([b], `${m.name}.${b.type.includes('wav') ? 'wav' : 'mp3'}`, { type: b.type || 'audio/mpeg' })); };
  const del = async () => { if (!ask) return; if (playing === ask.id) { audio.current?.pause(); setPlaying(null); } await deleteMusic([ask.id]); setAsk(null); onNotice('Track deleted'); void load(); };
  const rename = async () => { if (!edit) return; await renameMusic(edit.id, edit.name); setEdit(null); void load(); };

  return <section className="screen-card music-screen">
    <div className="music-head"><span className="eyebrow">Music Library</span>
      <button type="button" className="tl-pill" onClick={() => fileRef.current?.click()}><Plus size={15} /> Add tracks</button>
      <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = ''; }} /></div>
    {tracks.length === 0 && <div className="music-empty"><Music2 size={28} /><p>No background music yet. Add mp3 / wav / m4a tracks and reuse them in any video.</p></div>}
    <ul className="music-list">{tracks.map((m) => <li key={m.id}>
      <button type="button" className="music-play" aria-label={playing === m.id ? 'Pause' : 'Play'} onClick={() => void play(m)}>{playing === m.id ? <Pause size={18} /> : <Play size={18} />}</button>
      <div className="music-meta">{edit?.id === m.id
        ? <input className="studio-input" autoFocus value={edit.name} onChange={(e) => setEdit({ id: m.id, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void rename(); }} />
        : <strong>{m.name}</strong>}<small>{m.seconds ? fmt(m.seconds) : '--:--'} · {mb(m.size)}</small></div>
      {edit?.id === m.id ? <><button type="button" className="icon-button" aria-label="Save name" onClick={() => void rename()}><Check size={17} /></button><button type="button" className="icon-button" aria-label="Cancel" onClick={() => setEdit(null)}><X size={17} /></button></>
        : <><button type="button" className="icon-button" aria-label="Use in Timeline" title="Use in Timeline" onClick={() => void use(m)}><Clapperboard size={17} /></button><button type="button" className="icon-button" aria-label="Rename" onClick={() => setEdit({ id: m.id, name: m.name })}><Pencil size={16} /></button><button type="button" className="icon-button" aria-label="Delete" onClick={() => setAsk(m)}><Trash2 size={16} /></button></>}
    </li>)}</ul>
    {ask && <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 px-6" onMouseDown={() => setAsk(null)}><div role="alertdialog" className="w-full max-w-sm rounded-2xl bg-[var(--paper)] p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
      <h3 className="text-base font-bold">Delete “{ask.name}”?</h3><p className="mt-2 text-sm text-[var(--ink-soft)]">The track is removed from this device.</p>
      <div className="mt-4 flex gap-2"><button type="button" className="flex-1 rounded-xl border border-[var(--line)] py-3 text-sm font-semibold" onClick={() => setAsk(null)}>Cancel</button><button type="button" className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white" onClick={() => void del()}>Delete</button></div></div></div>}
  </section>;
}
