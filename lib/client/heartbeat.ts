'use client';

import { useEffect, useState } from 'react';
import { api, getVideoEndpoint } from './api';

export type Beat = 'unknown' | 'up' | 'down';

/**
 * Pings the GPU backend every 5 s. "down" needs 2 misses in a row (about 10 s) so one slow reply does not stop a job.
 * Errors from our own server (phone offline, wrong access key) are not counted: they say nothing about the GPU.
 * RunPod: only reads /health (free, does not wake a GPU). Colab/other: GET /hardware. No endpoint saved: checks /api/health.
 */
export function useHeartbeat(enabled: boolean): Beat {
  const [beat, setBeat] = useState<Beat>('unknown');
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let misses = 0;
    const ping = async () => {
      try {
        const ep = getVideoEndpoint();
        const ok = ep.url ? (await api.connect(ep, 'refresh')).ok : (await fetch('/api/health', { cache: 'no-store' })).ok;
        if (stopped) return;
        if (ok) { misses = 0; setBeat('up'); } else { misses += 1; if (misses >= 2) setBeat('down'); }
      } catch { /* our own server unreachable: no verdict */ }
    };
    void ping();
    const id = window.setInterval(ping, 5000);
    return () => { stopped = true; window.clearInterval(id); };
  }, [enabled]);
  return beat;
}
