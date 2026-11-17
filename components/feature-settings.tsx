'use client';

import { useEffect, useRef, useState } from 'react';
import { GripVertical, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_FEATURES, FEATURE_LABEL, type FeatureCfg } from '@/lib/client/features';

const HOLD_MS = 220;      // touch: press and hold this long, then drag (a quick swipe still scrolls the page)
const SLOP = 10;          // px of movement that counts as "scrolling", not "holding"

/** Settings block: switch features on/off, and press-and-hold a row then drag it wherever you want (like the iPhone Home Screen). */
export function FeatureSettings({ features, onChange }: { features: FeatureCfg[]; onChange: (next: FeatureCfg[]) => void }) {
  const listRef = useRef<HTMLUListElement>(null);
  const press = useRef<{ pid: number; x: number; y: number; timer: number | null; el: HTMLLIElement; grab: number; base: number; from: number; step: number; tgt: number } | null>(null);
  const dragging = useRef(false);
  // The DOM order never changes while dragging (moving a node would drop the touch). Other rows just slide aside; the order is saved on release.
  const [drag, setDrag] = useState<{ from: number; tgt: number; step: number } | null>(null);

  // iOS only lets us stop page scrolling from a non-passive touchmove listener; only active while dragging.
  useEffect(() => {
    const el = listRef.current; if (!el) return;
    const stop = (e: TouchEvent) => { if (dragging.current) e.preventDefault(); };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, []);

  const finish = (commit: boolean) => {
    const p = press.current;
    if (p?.timer) window.clearTimeout(p.timer);
    if (p) { p.el.style.transform = ''; try { p.el.releasePointerCapture(p.pid); } catch { /* already released */ } }
    if (commit && dragging.current && p && p.tgt !== p.from) { const next = features.slice(); const [m] = next.splice(p.from, 1); next.splice(p.tgt, 0, m); onChange(next); }
    press.current = null; dragging.current = false; setDrag(null);
  };

  const onDown = (e: React.PointerEvent<HTMLLIElement>, index: number) => {
    if ((e.target as HTMLElement).closest('.toggle')) return;          // the switch keeps working as a switch
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.currentTarget; const rect = el.getBoundingClientRect();
    const p = { pid: e.pointerId, x: e.clientX, y: e.clientY, timer: null as number | null, el, grab: e.clientY - rect.top, base: rect.top, from: index, step: rect.height + 6, tgt: index };
    press.current = p;
    const start = () => {
      dragging.current = true; setDrag({ from: index, tgt: index, step: p.step });
      try { el.setPointerCapture(p.pid); } catch { /* ignore */ }
      navigator.vibrate?.(12);
    };
    if (e.pointerType === 'mouse') start(); else p.timer = window.setTimeout(start, HOLD_MS);
  };

  const onMove = (e: React.PointerEvent<HTMLLIElement>) => {
    const p = press.current; if (!p) return;
    if (!dragging.current) {                                            // finger moved before the hold finished = the user is scrolling
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) finish(false);
      return;
    }
    const shift = e.clientY - p.grab - p.base;                          // the row follows the finger
    p.el.style.transform = `translateY(${shift}px) scale(1.02)`;
    const tgt = Math.max(0, Math.min(features.length - 1, p.from + Math.round(shift / p.step)));
    if (tgt !== p.tgt) { p.tgt = tgt; setDrag({ from: p.from, tgt, step: p.step }); }
  };

  const slide = (i: number): React.CSSProperties | undefined => {
    if (!drag || i === drag.from) return undefined;
    if (i > drag.from && i <= drag.tgt) return { transform: `translateY(${-drag.step}px)` };
    if (i < drag.from && i >= drag.tgt) return { transform: `translateY(${drag.step}px)` };
    return undefined;
  };

  return <div className="settings-block" id="menu-features">
    <div className="settings-title"><SlidersHorizontal size={17} /><strong>Menu &amp; features</strong></div>
    <p className="access-help">Switch a feature off to hide it everywhere (sidebar and Command Center). Press and hold a row, then drag it to where you want.</p>
    <ul className="feat-list" ref={listRef}>
      {features.map((f, i) => <li key={f.id} style={slide(i)}
        className={`feat-row ${f.on ? '' : 'off'} ${drag?.from === i ? 'dragging' : ''} ${drag && drag.from !== i ? 'sliding' : ''}`}
        onPointerDown={(e) => onDown(e, i)} onPointerMove={onMove} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} onContextMenu={(e) => e.preventDefault()}>
        <GripVertical size={16} className="feat-grip" aria-hidden />
        <span className="feat-name">{FEATURE_LABEL[f.id]}</span>
        <button type="button" role="switch" aria-checked={f.on} aria-label={`${FEATURE_LABEL[f.id]} ${f.on ? 'on' : 'off'}`} className={`toggle ${f.on ? 'is-on' : ''}`} onClick={() => onChange(features.map((x) => (x.id === f.id ? { ...x, on: !x.on } : x)))}><span /></button>
      </li>)}
    </ul>
    <button type="button" className="text-button" onClick={() => onChange(DEFAULT_FEATURES.map((d) => ({ ...d })))}>Reset menu</button>
  </div>;
}
