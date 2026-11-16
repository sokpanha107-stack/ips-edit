'use client';

import { useMemo, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { assemble, MOTIONS, parseMasterScript, TRANSITIONS, type Assembly } from '@/lib/client/autoEdit';
import type { Asset } from '@/lib/client/timeline';

const FORMAT = '[Scene X] | Image: filename.jpg | Motion: [Motion_Type] | Transition: [Transition_Type]';

/** Paste one master script, press Auto-Assemble: no dragging. Each image is stretched to exactly its audio's length. */
export function AutoEditor({ assets, onAssemble, onNotice }: { assets: Asset[]; onAssemble: (a: Assembly) => void; onNotice: (m: string) => void }) {
  const [text, setText] = useState('');
  const [tlen, setTlen] = useState(0.5);
  const [report, setReport] = useState<{ errors: string[]; warnings: string[]; ok?: string } | null>(null);
  const voices = assets.filter((a) => a.kind === 'voice');
  const images = assets.filter((a) => a.kind === 'visual');
  const parsed = useMemo(() => parseMasterScript(text), [text]);

  const example = () => {
    const n = Math.max(images.length, voices.length, 3);
    setText(Array.from({ length: n }, (_, i) => `[Scene ${i + 1}] | Image: ${images[i]?.name ?? `scene-${String(i + 1).padStart(2, '0')}.png`} | Motion: ${MOTIONS[i % 4]} | Transition: ${i % 2 ? 'dissolve' : 'fade'}`).join('\n'));
  };
  const run = () => {
    if (!text.trim()) { onNotice('Paste the master script first.'); return; }
    if (parsed.issues.length || !parsed.scenes.length) { setReport({ errors: parsed.issues.map((i) => `Line ${i.line}: ${i.reason}`), warnings: [] }); return; }
    const res = assemble(parsed.scenes, assets, tlen);
    if (res.errors.length) { setReport({ errors: res.errors, warnings: res.warnings }); return; }
    onAssemble(res);
    const total = res.visuals.reduce((n, v) => n + v.duration, 0);
    setReport({ errors: [], warnings: res.warnings, ok: `${res.visuals.length} scenes assembled · ${total.toFixed(2)} s` });
    onNotice('Timeline assembled from the master script');
  };

  return <details className="tl-panel" open>
    <summary><Wand2 size={15} /> Master Script Auto-Editor</summary>
    <p className="access-help">Format, one scene per line: <code>{FORMAT}</code><br />Motion: {MOTIONS.join(', ')} · Transition (how the scene enters): {TRANSITIONS.join(', ')}. Audio is matched by the scene number in its file name (scene_03.mp3 → Scene 3).</p>
    <textarea className="studio-textarea auto-text" rows={10} value={text} spellCheck={false} placeholder={`${FORMAT}\n\n[Scene 1] | Image: scene-01.png | Motion: zoom_in | Transition: fade`} onChange={(e) => { setText(e.target.value); setReport(null); }} />
    <div className="tl-chips">
      <button type="button" className="chip" onClick={example}>Fill example from my files</button>
      <label className="tl-check">Transition length <input className="studio-input" style={{ width: 70, margin: 0 }} inputMode="decimal" value={tlen} onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); if (n >= 0 && n <= 3) setTlen(n); }} /> s</label>
      <span className="tl-time">{parsed.scenes.length} scene(s) read{parsed.issues.length ? ` · ${parsed.issues.length} line(s) to fix` : ''}</span>
    </div>
    {voices.length > 0 && <table className="auto-table"><thead><tr><th>Audio file</th><th>Detected length</th></tr></thead>
      <tbody>{voices.map((v) => <tr key={v.id}><td>{v.name}</td><td>{v.duration > 0 ? `${v.duration.toFixed(3)} s` : 'unreadable'}</td></tr>)}</tbody></table>}
    <button type="button" className="primary-button big-copy" onClick={run}><Wand2 size={16} /> Auto-Assemble</button>
    {report?.ok && <div className="access-status ok">{report.ok}</div>}
    {report?.errors.map((e, i) => <div key={i} className="access-status bad">{e}</div>)}
    {report?.warnings.map((w, i) => <div key={i} className="access-status">{w}</div>)}
  </details>;
}
