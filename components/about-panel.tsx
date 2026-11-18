'use client';

import { useRef, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { ABOUT_INTRO, ABOUT_SECTIONS, ABOUT_UPDATED, ABOUT_VERSION } from '@/lib/about';
import { ArchitectureDiagram, WorkflowDiagram } from '@/components/about-diagrams';

/** A4 page at 96 dpi. */
const PAGE_W = 794;
const PAGE_H = 1123;
const MARGIN = 48;

/** Full-screen manual (សៀវភៅណែនាំ). The same text grounds the Gemini assistant (lib/about.ts). */
export function AboutPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const sheet = useRef<HTMLDivElement>(null);
  if (!open) return null;

  /** Renders the off-screen A4 sheet block by block (so Khmer shaping is exact) and places the blocks onto A4 pages. */
  const exportPdf = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      if (document.fonts?.ready) await document.fonts.ready;
      const pdf = new jsPDF({ unit: 'px', format: [PAGE_W, PAGE_H], hotfixes: ['px_scaling'] });
      const blocks = Array.from(sheet.current?.querySelectorAll<HTMLElement>('[data-pdf-block]') ?? []);
      let y = MARGIN;
      let page = 1;
      const paint = () => { pdf.setFillColor(244, 236, 223); pdf.rect(0, 0, PAGE_W, PAGE_H, 'F'); };
      const footer = (n: number) => { pdf.setFontSize(9); pdf.setTextColor(107, 99, 88); pdf.text(`Atom Edit · v${ABOUT_VERSION} · ${ABOUT_UPDATED}`, MARGIN, PAGE_H - 24); pdf.text(String(n), PAGE_W - MARGIN, PAGE_H - 24, { align: 'right' }); };
      paint();
      for (const el of blocks) {
        const canvas = await html2canvas(el, { scale: 2, backgroundColor: null, useCORS: true, logging: false });
        const full = PAGE_W - MARGIN * 2;
        const w = Math.min(full, canvas.width / 2);          // natural size (canvas is 2x), so narrow diagrams stay narrow
        const h = (canvas.height / canvas.width) * w;
        if (y + h > PAGE_H - 48 && y > MARGIN) { footer(page); pdf.addPage([PAGE_W, PAGE_H]); page += 1; paint(); y = MARGIN; }
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN + (full - w) / 2, y, w, h);
        y += h + 14;
      }
      footer(page);
      pdf.save(`Atom-Edit-Manual-v${ABOUT_VERSION}.pdf`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the PDF');
    }
    setBusy(false);
  };

  return <div className="about-screen" role="dialog" aria-label="About Atom Edit">
    <div className="about-top">
      <button type="button" className="primary-button about-export" onClick={() => void exportPdf()} disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}{busy ? 'Creating PDF…' : 'Export PDF'}</button>
      <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={22} /></button>
    </div>
    <div className="about-body">
      <header className="about-brand"><img src="/icon-192.png" alt="" width={72} height={72} /><h1>Atom <em>Edit</em></h1><p>សៀវភៅណែនាំ · User Manual · v{ABOUT_VERSION} · {ABOUT_UPDATED}</p></header>
      {err && <p className="ai-err">{err}</p>}
      <p className="about-intro">{ABOUT_INTRO}</p>
      <nav className="about-toc" aria-label="Contents">{ABOUT_SECTIONS.map((s, i) => <a key={s.id} href={`#about-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`about-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{String(i + 1).padStart(2, '0')} · {s.title}</a>)}</nav>
      <section className="about-sec"><h2><span>◆</span>Workflow</h2><WorkflowDiagram /></section>
      <section className="about-sec"><h2><span>◆</span>Architecture</h2><ArchitectureDiagram /></section>
      {ABOUT_SECTIONS.map((s, i) => <section key={s.id} id={`about-${s.id}`} className="about-sec"><h2><span>{String(i + 1).padStart(2, '0')}</span>{s.title}</h2><p>{s.body}</p></section>)}
    </div>

    {/* Off-screen A4 sheet used only for the PDF (same content, print-friendly widths). */}
    <div ref={sheet} className="pdf-sheet" aria-hidden="true" style={{ width: PAGE_W - MARGIN * 2 }}>
      <div data-pdf-block className="pdf-brand"><img src="/icon-512.png" alt="" width={84} height={84} /><div><h1>Atom <em>Edit</em></h1><p>សៀវភៅណែនាំ · User Manual · v{ABOUT_VERSION} · {ABOUT_UPDATED}</p></div></div>
      <div data-pdf-block className="pdf-p">{ABOUT_INTRO}</div>
      <div data-pdf-block className="pdf-fig"><div className="pdf-h">Workflow</div><WorkflowDiagram /></div>
      <div data-pdf-block className="pdf-fig"><div className="pdf-h">Architecture</div><ArchitectureDiagram /></div>
      {ABOUT_SECTIONS.map((s, i) => <div data-pdf-block key={s.id} className="pdf-sec"><h2><span>{String(i + 1).padStart(2, '0')}</span>{s.title}</h2><p>{s.body}</p></div>)}
    </div>
  </div>;
}
