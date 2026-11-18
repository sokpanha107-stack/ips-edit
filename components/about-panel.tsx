'use client';

import { X } from 'lucide-react';
import { ABOUT_INTRO, ABOUT_SECTIONS } from '@/lib/about';

/** Full-screen manual (សៀវភៅណែនាំ). The same text grounds the Gemini assistant (lib/about.ts). */
export function AboutPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <div className="about-screen" role="dialog" aria-label="About IPS edit">
    <div className="about-top"><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={22} /></button></div>
    <div className="about-body">
      <header className="about-brand"><img src="/icon-192.png" alt="" width={72} height={72} /><h1>IPS edit</h1><p>សៀវភៅណែនាំ · User Manual</p></header>
      <p className="about-intro">{ABOUT_INTRO}</p>
      <nav className="about-toc" aria-label="Contents">{ABOUT_SECTIONS.map((s, i) => <a key={s.id} href={`#about-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`about-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{String(i + 1).padStart(2, '0')} · {s.title}</a>)}</nav>
      {ABOUT_SECTIONS.map((s, i) => <section key={s.id} id={`about-${s.id}`} className="about-sec"><h2><span>{String(i + 1).padStart(2, '0')}</span>{s.title}</h2><p>{s.body}</p></section>)}
    </div>
  </div>;
}
