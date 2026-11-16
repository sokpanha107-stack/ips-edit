import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/backend/session';
import { createJob, tick } from '@/lib/backend/engine';
import { ProviderConfigError } from '@/lib/backend/providers';
import { getStore } from '@/lib/backend/store';
import { toView } from '@/lib/backend/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  engine: z.enum(['video', 'kh', 'en']),
  folder: z.string().trim().min(1).max(60),
  masterPrompt: z.string().trim().min(1).max(4000),
  scenes: z.array(z.string().max(4000)).min(1).max(200),
  imageDataUrl: z.string().max(6_000_000).startsWith('data:image/').optional(),
  voiceId: z.string().max(100).optional(),
  options: z.record(z.unknown()).optional(),
});

export async function POST(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res; const me = au.ctx;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  const secs = parsed.data.options?.sceneSeconds;
  if (secs !== undefined && !(Array.isArray(secs) && secs.length === parsed.data.scenes.length && secs.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 600))) {
    return NextResponse.json({ error: 'sceneSeconds must list one length (seconds) per scene' }, { status: 400 });
  }
  if (parsed.data.engine === 'video' && !parsed.data.imageDataUrl) return NextResponse.json({ error: 'video jobs need a base image' }, { status: 400 });
  try {
    const job = await createJob(me, parsed.data);
    const started = (await tick(me, job.id)) ?? job;
    return NextResponse.json(toView(started), { status: 201 });
  } catch (err) {
    const status = err instanceof ProviderConfigError ? 503 : 400;
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status });
  }
}

export async function GET(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res; const me = au.ctx;
  const jobs = await getStore(me.db, me.userId).listJobs(50);
  return NextResponse.json({ jobs: jobs.map(toView) });
}
