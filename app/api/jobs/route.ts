import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAccess } from '@/lib/backend/auth';
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
  const denied = requireAccess(req);
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  if (parsed.data.engine === 'video' && !parsed.data.imageDataUrl) return NextResponse.json({ error: 'video jobs need a base image' }, { status: 400 });
  try {
    const job = await createJob(parsed.data);
    const started = (await tick(job.id)) ?? job;
    return NextResponse.json(toView(started), { status: 201 });
  } catch (err) {
    const status = err instanceof ProviderConfigError ? 503 : 400;
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status });
  }
}

export async function GET(req: Request) {
  const denied = requireAccess(req);
  if (denied) return denied;
  const jobs = await getStore().listJobs(50);
  return NextResponse.json({ jobs: jobs.map(toView) });
}
