import { NextResponse } from 'next/server';
import { requireAccess } from '@/lib/backend/auth';
import { cancelJob, tick } from '@/lib/backend/engine';
import { toView } from '@/lib/backend/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: { id: string } };

/** Polling this endpoint also advances the job (poll provider + submit queued scenes). */
export async function GET(req: Request, { params }: Ctx) {
  const denied = requireAccess(req);
  if (denied) return denied;
  const job = await tick(params.id);
  return job ? NextResponse.json(toView(job)) : NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = requireAccess(req);
  if (denied) return denied;
  const job = await cancelJob(params.id);
  return job ? NextResponse.json(toView(job)) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
