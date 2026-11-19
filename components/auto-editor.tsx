'use client';

import { useMemo, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { assemble, CAMERAS, FORMAT_FULL, MOTIONS, OVERLAYS, parseMasterScript, SFXS, TRANSITIONS, type Assembly } from '@/lib/client/autoEdit';
import type { Asset } from '@/lib/client/timeline';

const FORMAT = FORMAT_FULL;

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
    setText(Array.from({ length: n }, (_, i) => `[Scene ${i + 1}] | Image: ${images[i]?.name ?? `scene-${String(i + 1).padStart(2, '0')}.png`} | Motion: ${MOTIONS[i % 4]} | Transition: ${i % 2 ? 'dissolve' : 'fade'}${i === 0 ? ' | Depth: on | Camera: handheld_breath' : ''}`).join('\n'));
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
    <p className="access-help">One scene per line. Only <code>[Scene X] | Image: file</code> is required; every other tag is optional, any order, any case (Zoom In = zoom_in). Audio is matched by the scene number in its file name (scene_03.mp3 → Scene 3).</p>
    <details className="cheat">
      <summary>Syntax cheat-sheet</summary>
      <p className="access-help"><code>{FORMAT}</code></p>
      <ul className="access-help cheat-list">
        <li><b>Motion</b>: {MOTIONS.join(', ')}</li>
        <li><b>Transition</b>: {TRANSITIONS.join(', ')} (Crossfade = dissolve)</li>
        <li><b>Depth</b>: on / off / 2.5d_parallax</li>
        <li><b>Camera</b>: {CAMERAS.join(', ')}</li>
        <li><b>Overlay</b>: {OVERLAYS.join(', ')}</li>
        <li><b>Callout</b>: &quot;Text or number&quot; (animated card beside the subject)</li>
        <li><b>SFX</b>: {SFXS.join(', ')}</li>
        <li><b>Subtitle</b>: 1-Line … (word-by-word reveal) or Full Block … (pop-up, then word highlight)</li>
      </ul>
    </details>
    <textarea className="studio-textarea auto-text" rows={10} value={text} spellCheck={false} placeholder={`${FORMAT}\n\n[Scene 1] | Image: scene-01.png | Motion: Zoom In | Transition: Crossfade | Depth: on | Camera: handheld_breath | Subtitle: 1-Line`} onChange={(e) => { setText(e.target.value); setReport(null); }} />
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
