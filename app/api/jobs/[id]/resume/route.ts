import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAccess } from '@/lib/backend/auth';
import { resumeJob } from '@/lib/backend/engine';
import { toView } from '@/lib/backend/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ endpoint: z.object({ url: z.string().url().max(500), key: z.string().max(500).optional() }).optional() });

/** Continue from the first unfinished scene. Optional new GPU endpoint (e.g. a fresh Colab URL). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const denied = requireAccess(req);
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  try {
    const job = await resumeJob(params.id, parsed.data.endpoint);
    return job ? NextResponse.json(toView(job)) : NextResponse.json({ error: 'not found' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 400 });
  }
}
