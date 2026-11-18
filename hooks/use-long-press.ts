'use client';
import { useCallback, useRef } from 'react';

/**
 * Long press for touch + mouse. Cancels when the finger moves (so scrolling still works) and swallows the click
 * that follows a long press. Spread the returned props on the element; call `consumed()` at the top of onClick.
 */
export function useLongPress(onLong: () => void, ms = 480) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const clear = useCallback(() => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } }, []);
  return {
    consumed: () => { const f = fired.current; fired.current = false; return f; },
    props: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        fired.current = false; start.current = { x: e.clientX, y: e.clientY }; clear();
        timer.current = window.setTimeout(() => { fired.current = true; timer.current = null; try { navigator.vibrate?.(12); } catch { /* not supported */ } onLong(); }, ms);
      },
      onPointerMove: (e: React.PointerEvent) => { const s = start.current; if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 9) clear(); },
      onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  };
}
