import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAccess } from '@/lib/backend/auth';
import { authHeaders, fetchJson, isRunpod, normalizeBase, normalizeHardware, type Hardware } from '@/lib/backend/endpoint';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  url: z.string().max(500),
  key: z.string().max(500).optional(),
  /** connect = full check (may wake a RunPod worker once). refresh = cheap status only, safe to poll. */
  mode: z.enum(['connect', 'refresh']).default('connect'),
});

/**
 * Check a user-supplied GPU worker and return its real hardware.
 *  - Generic server (Colab etc.): GET {base}/hardware every time.
 *  - RunPod Serverless: GET /health (free) always; the hardware itself needs a worker, so it is requested once on "connect"
 *    (the worker answers {engine:'hardware'} without loading the model).
 */
export async function POST(req: Request) {
  const denied = requireAccess(req);
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid request' }, { status: 400 });

  let base: string;
  try { base = normalizeBase(parsed.data.url); } catch (e) { return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 }); }
  const ep = { url: base, key: parsed.data.key };
  const headers = authHeaders(ep);

  try {
    if (isRunpod(base)) {
      const health = await fetchJson(`${base}/health`, { headers });
      if (health.status === 401 || health.status === 403) return NextResponse.json({ ok: false, error: 'RunPod rejected the API key.' }, { status: 200 });
      if (!health.ok) return NextResponse.json({ ok: false, error: `RunPod endpoint not found or not ready (${health.status}). Check the endpoint ID in the URL.` });
      const w = health.data?.workers ?? {};
      const j = health.data?.jobs ?? {};
      let hardware: Hardware | null = null;
      let note: string | undefined;
      if (parsed.data.mode === 'connect') {
        try {
          const r = await fetchJson(`${base}/runsync`, { method: 'POST', headers, body: JSON.stringify({ input: { engine: 'hardware' } }), timeoutMs: 50000 });
          hardware = r.ok && r.data?.status === 'COMPLETED' ? normalizeHardware(r.data.output) : null;
          if (!hardware) note = 'Connected. The GPU is still starting up; hardware details will appear after the first job.';
        } catch { note = 'Connected. The GPU is asleep (cold start); hardware details will appear after the first job.'; }
      }
      const activeTasks = (Number(j.inProgress) || 0) + (Number(j.inQueue) || 0);
      return NextResponse.json({ ok: true, kind: 'runpod', hardware, workers: { idle: Number(w.idle) || 0, running: Number(w.running) || 0, ready: Number(w.ready) || 0 }, activeTasks, note });
    }

    const hw = await fetchJson(`${base}/hardware`, { headers });
    if (hw.status === 401 || hw.status === 403) return NextResponse.json({ ok: false, error: 'The worker rejected the key.' });
    const hardware = hw.ok ? normalizeHardware(hw.data) : null;
    if (!hardware) {
      const h = await fetchJson(`${base}/health`, { headers }).catch(() => null);
      if (!h?.ok) return NextResponse.json({ ok: false, error: 'Could not reach the worker. Is the Colab session still running and the URL current?' });
      return NextResponse.json({ ok: true, kind: 'http', hardware: null, note: 'Connected, but this worker does not report hardware (GET /hardware).' });
    }
    return NextResponse.json({ ok: true, kind: 'http', hardware, activeTasks: hardware.activeTasks });
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'The worker did not answer in time.' : 'Could not reach the worker.';
    return NextResponse.json({ ok: false, error: msg });
  }
}
