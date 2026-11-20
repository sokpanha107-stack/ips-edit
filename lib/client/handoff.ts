/** One-way inbox between screens that are always mounted (Script Preparation -> Image Engine / Timeline). Survives a reload until the target takes it. */
export type HandoffTarget = 'image' | 'timeline';
const key = (t: HandoffTarget) => `ips-handoff-${t}`;
const EVT = 'ips-handoff';

export function sendHandoff(target: HandoffTarget, scenes: string[]) {
  try { localStorage.setItem(key(target), JSON.stringify({ scenes, at: Date.now() })); } catch { /* storage unavailable: the event below still delivers it */ }
  window.dispatchEvent(new CustomEvent<{ target: HandoffTarget; scenes: string[] }>(EVT, { detail: { target, scenes } }));
}

/** Delivers a waiting handoff once now (if any) and every future one. Returns the unsubscribe function. */
export function onHandoff(target: HandoffTarget, cb: (scenes: string[]) => void): () => void {
  const take = () => {
    try { const raw = localStorage.getItem(key(target)); if (!raw) return; localStorage.removeItem(key(target)); const s = JSON.parse(raw)?.scenes; if (Array.isArray(s) && s.length) cb(s.map(String)); } catch { /* ignore */ }
  };
  const on = (e: Event) => { if ((e as CustomEvent<{ target: HandoffTarget }>).detail?.target === target) take(); };
  window.addEventListener(EVT, on); take();
  return () => window.removeEventListener(EVT, on);
}
