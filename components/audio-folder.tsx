'use client';

import { useRef, useState } from 'react';
import { Check, FolderUp, Music2, X } from 'lucide-react';

export interface AudioItem { name: string; seconds: number }

export const videoCopy = {
  en: {
    folderBtn: 'Add audio folder', folderHelp: 'Pick the folder with 01.mp3, 02.mp3… Lengths are read on this device; nothing is uploaded. If your phone cannot pick a folder, select all the files at once.',
    reading: 'Reading audio lengths…', files: 'files', total: 'Total', remove: 'Remove', report: 'KH audio = timing anchor · seconds per scene', scene: 'Scene',
    noAudioFound: 'No audio files found in that selection.', unreadable: 'Could not read', mismatch: (a: number, s: number) => `Audio has ${a} files but scenes is set to ${s}`,
    rendering: 'Rendering', of: 'of', done: 'done', online: 'GPU online', offline: 'GPU offline', checking: 'Checking GPU…', resume: 'Resume',
    paused: (saved: number, next: number) => `Connection lost. ${saved} scenes are saved. Resume continues from scene ${next}.`,
    stillOffline: 'The GPU worker is still offline. Check Performance Monitor, then try again.',
    anchorMismatch: (a: number, s: number) => `KH timing has ${a} scenes but scenes is set to ${s}`, anchorFromKh: (n: number) => `Timing anchor updated from KH voice (${n} scenes)`,
  },
  kh: {
    folderBtn: 'បញ្ចូល Folder សំឡេង', folderHelp: 'ជ្រើស Folder ដែលមាន 01.mp3, 02.mp3… ប្រវែងត្រូវបានអានក្នុងឧបករណ៍នេះ មិនបាន upload ទេ។ បើទូរស័ព្ទមិនអាចជ្រើស Folder សូមជ្រើសឯកសារទាំងអស់ក្នុងពេលតែមួយ។',
    reading: 'កំពុងអានប្រវែងសំឡេង…', files: 'ឯកសារ', total: 'សរុប', remove: 'លុប', report: 'សំឡេង KH = ស្តង់ដារពេលវេលា · វិនាទីតាម scene', scene: 'Scene',
    noAudioFound: 'រកមិនឃើញឯកសារសំឡេងទេ។', unreadable: 'អានមិនបាន', mismatch: (a: number, s: number) => `សំឡេងមាន ${a} ឯកសារ ប៉ុន្តែអ្នកកំណត់ ${s} scene`,
    rendering: 'កំពុងកិន', of: '/', done: 'រួច', online: 'GPU ភ្ជាប់', offline: 'GPU ដាច់', checking: 'កំពុងពិនិត្យ GPU…', resume: 'Resume',
    paused: (saved: number, next: number) => `ដាច់ទំនាក់ទំនង។ រក្សាទុក ${saved} scene រួច។ Resume នឹងបន្តពី scene ${next}។`,
    stillOffline: 'ម៉ាស៊ីន GPU នៅតែដាច់។ សូមពិនិត្យ Performance Monitor ហើយសាកល្បងម្តងទៀត។',
    anchorMismatch: (a: number, s: number) => `ពេលវេលា KH មាន ${a} scene ប៉ុន្តែអ្នកកំណត់ ${s}`, anchorFromKh: (n: number) => `បានធ្វើបច្ចុប្បន្នភាពស្តង់ដារពេលវេលាពីសំឡេង KH (${n} scene)`,
  },
} as const;
export type VideoCopy = (typeof videoCopy)['en'] | (typeof videoCopy)['kh'];

/** Length of an audio file reachable by URL (used for finished KH voice scenes). */
export function readAudioUrl(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? resolve(Math.round(audio.duration * 100) / 100) : reject(new Error('no duration')));
    audio.onerror = () => reject(new Error('unreadable'));
    window.setTimeout(() => reject(new Error('timeout')), 20000);
    audio.src = url;
  });
}

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm)$/i;

function duration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let finished = false;
    const end = () => { finished = true; URL.revokeObjectURL(url); audio.removeAttribute('src'); };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => { const d = audio.duration; end(); Number.isFinite(d) && d > 0 ? resolve(d) : reject(new Error('no duration')); };
    audio.onerror = () => { end(); reject(new Error('unreadable')); };
    window.setTimeout(() => { if (!finished) { end(); reject(new Error('timeout')); } }, 15000);
    audio.src = url;
  });
}

/** HTML5 Audio API, on this device only. Files are sorted by name (01, 02, … 10). */
export async function readAudioFiles(list: File[]): Promise<{ items: AudioItem[]; failed: string[] }> {
  const files = list.filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const items: AudioItem[] = [];
  const failed: string[] = [];
  for (const f of files) {
    try { items.push({ name: f.name, seconds: Math.round((await duration(f)) * 100) / 100 }); } catch { failed.push(f.name); }
  }
  return { items, failed };
}

const fmt = (s: number) => `${s.toFixed(1)}s`;
const pad = (n: number) => String(n).padStart(2, '0');

export function AudioFolderPicker({ c, items, onChange, onNotice, disabled }: { c: VideoCopy; items: AudioItem[]; onChange: (items: AudioItem[]) => void; onNotice: (m: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const total = items.reduce((n, i) => n + i.seconds, 0);
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const { items: found, failed } = await readAudioFiles(Array.from(files));
    setBusy(false);
    if (!found.length) { onNotice(failed.length ? `${c.unreadable}: ${failed.slice(0, 3).join(', ')}` : c.noAudioFound); return; }
    if (failed.length) onNotice(`${c.unreadable}: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`);
    onChange(found);
  };
  return <div className="audio-box">
    <div className="audio-row">
      <button type="button" className="text-button audio-pick" disabled={busy || disabled} onClick={() => ref.current?.click()}><FolderUp size={16} /> {busy ? c.reading : c.folderBtn}</button>
      {items.length > 0 && <span className="audio-sum"><Check size={12} /> {items.length} {c.files} · {fmt(total)}<button type="button" className="audio-clear" disabled={disabled} onClick={() => onChange([])} aria-label={c.remove}><X size={13} /></button></span>}
    </div>
    <input ref={ref} type="file" accept="audio/*" multiple hidden {...({ webkitdirectory: '' } as Record<string, string>)} onChange={(e) => { void pick(e.target.files); e.target.value = ''; }} />
    {items.length === 0 && <p className="access-help">{c.folderHelp}</p>}
  </div>;
}

export function AudioReport({ c, items }: { c: VideoCopy; items: AudioItem[] }) {
  const total = items.reduce((n, i) => n + i.seconds, 0);
  return <div className="audio-report">
    <div className="audio-report-head"><Music2 size={13} /> {c.report}</div>
    <table><tbody>
      {items.map((it, i) => <tr key={`${it.name}-${i}`}><td>{c.scene} {pad(i + 1)}</td><td className="audio-name">{it.name}</td><td>{fmt(it.seconds)}</td></tr>)}
      <tr className="audio-total"><td>{c.total}</td><td /><td>{fmt(total)}</td></tr>
    </tbody></table>
  </div>;
}
