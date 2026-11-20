'use client';

import { Library, Mic2, Music2 } from 'lucide-react';

export type LibraryTab = 'prompts' | 'voices' | 'music';
const TABS: { id: LibraryTab; label: string; icon: typeof Library }[] = [
  { id: 'prompts', label: 'Prompt Library', icon: Library }, { id: 'voices', label: 'Voice Library', icon: Mic2 }, { id: 'music', label: 'Music Library', icon: Music2 },
];

/** The 3-section strip shown at the top of every Library screen. */
export function LibraryTabs({ active, onGo, enabled }: { active: LibraryTab; onGo: (t: LibraryTab) => void; enabled: Record<LibraryTab, boolean> }) {
  return <div className="lib-tabs" role="tablist" aria-label="Library">{TABS.filter((t) => enabled[t.id]).map((t) => { const I = t.icon; return <button key={t.id} type="button" role="tab" aria-selected={active === t.id} className={active === t.id ? 'active' : ''} onClick={() => onGo(t.id)}><I size={15} /><span>{t.label}</span></button>; })}</div>;
}
