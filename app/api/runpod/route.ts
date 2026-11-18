import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/backend/session';
import { getCredential } from '@/lib/backend/vault';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const body = z.object({ action: z.enum(['status', 'start', 'stop']), podId: z.string().regex(/^[a-z0-9]{6,40}$/i, 'invalid Pod ID') });

const QUERY = `query($id:String!){pod(input:{podId:$id}){id name desiredStatus vcpuCount memoryInGb
  machine{gpuDisplayName} runtime{uptimeInSeconds gpus{gpuUtilPercent memoryUtilPercent} container{cpuPercent memoryPercent}}}}`;

/**
 * RunPod *Pod* monitor + power switch (Serverless endpoints scale themselves and expose no CPU/RAM/VRAM).
 * The API key comes from the user's encrypted Vault and is never sent to the browser.
 */
export async function POST(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  const cred = await getCredential(au.ctx.db, au.ctx.userId, 'runpod').catch(() => null);
  if (!cred?.key) return NextResponse.json({ ok: false, error: 'Add your RunPod API key in Settings → API Key Vault first.' });
  const { action, podId } = parsed.data;
  const auth = { Authorization: `Bearer ${cred.key}` };
  try {
    if (action === 'status') {
      const r = await fetch('https://api.runpod.io/graphql', { method: 'POST', cache: 'no-store', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: QUERY, variables: { id: podId } }), signal: AbortSignal.timeout(15000) });
      if (r.status === 401 || r.status === 403) return NextResponse.json({ ok: false, error: 'RunPod rejected the API key.' });
      const j = await r.json().catch(() => null) as { data?: { pod?: any }; errors?: { message: string }[] } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
      const pod = j?.data?.pod;
      if (!pod) return NextResponse.json({ ok: false, error: j?.errors?.[0]?.message ?? 'Pod not found. Check the Pod ID.' });
      const g = pod.runtime?.gpus?.[0];
      return NextResponse.json({ ok: true, state: String(pod.desiredStatus), gpu: pod.machine?.gpuDisplayName ?? null, uptime: pod.runtime?.uptimeInSeconds ?? null,
        cpuPct: pod.runtime?.container?.cpuPercent ?? null, ramPct: pod.runtime?.container?.memoryPercent ?? null, ramGb: pod.memoryInGb ?? null,
        vramPct: g?.memoryUtilPercent ?? null, gpuPct: g?.gpuUtilPercent ?? null });
    }
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/${action}`, { method: 'POST', cache: 'no-store', headers: auth, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return NextResponse.json({ ok: false, error: `RunPod ${action} failed (${r.status}): ${(await r.text().catch(() => '')).slice(0, 160)}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'RunPod unreachable' });
  }
}
