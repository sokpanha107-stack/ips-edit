'use client';

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_FEATURES, FEATURE_LABEL, type FeatureCfg } from '@/lib/client/features';

/** Settings block: switch features on/off and drag them into the order you want. Up/down buttons do the same on touch screens. */
export function FeatureSettings({ features, onChange }: { features: FeatureCfg[]; onChange: (next: FeatureCfg[]) => void }) {
  const dragId = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= features.length || from === to) return;
    const next = features.slice(); const [m] = next.splice(from, 1); next.splice(to, 0, m); onChange(next);
  };
  const drop = (targetId: string) => {
    const a = features.findIndex((f) => f.id === dragId.current), b = features.findIndex((f) => f.id === targetId);
    dragId.current = null; setOver(null);
    if (a >= 0 && b >= 0) move(a, b);
  };
  return <div className="settings-block" id="menu-features">
    <div className="settings-title"><SlidersHorizontal size={17} /><strong>Menu &amp; features</strong></div>
    <p className="access-help">Switch a feature off to hide it everywhere (sidebar and Command Center). Drag to reorder.</p>
    <ul className="feat-list">
      {features.map((f, i) => <li key={f.id} className={`feat-row ${f.on ? '' : 'off'} ${over === f.id ? 'over' : ''}`} draggable
        onDragStart={() => { dragId.current = f.id; }} onDragOver={(e) => { e.preventDefault(); setOver(f.id); }} onDragLeave={() => setOver(null)} onDrop={() => drop(f.id)} onDragEnd={() => setOver(null)}>
        <GripVertical size={16} className="feat-grip" aria-hidden />
        <span className="feat-name">{FEATURE_LABEL[f.id]}</span>
        <button type="button" className="icon-button sm" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${FEATURE_LABEL[f.id]} up`}><ArrowUp size={13} /></button>
        <button type="button" className="icon-button sm" onClick={() => move(i, i + 1)} disabled={i === features.length - 1} aria-label={`Move ${FEATURE_LABEL[f.id]} down`}><ArrowDown size={13} /></button>
        <button type="button" role="switch" aria-checked={f.on} aria-label={`${FEATURE_LABEL[f.id]} ${f.on ? 'on' : 'off'}`} className={`toggle ${f.on ? 'is-on' : ''}`} onClick={() => onChange(features.map((x) => (x.id === f.id ? { ...x, on: !x.on } : x)))}><span /></button>
      </li>)}
    </ul>
    <button type="button" className="text-button" onClick={() => onChange(DEFAULT_FEATURES.map((d) => ({ ...d })))}>Reset menu</button>
  </div>;
}
