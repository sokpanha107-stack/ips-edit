import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/backend/session';
import { cancelJob, tick } from '@/lib/backend/engine';
import { toView } from '@/lib/backend/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: { id: string } };

/** Polling this endpoint also advances the job (poll provider + submit queued scenes). */
export async function GET(req: Request, { params }: Ctx) {
  const au = await requireUser(); if ('res' in au) return au.res; const me = au.ctx;
  const job = await tick(me, params.id);
  return job ? NextResponse.json(toView(job)) : NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const au = await requireUser(); if ('res' in au) return au.res; const me = au.ctx;
  const job = await cancelJob(me, params.id);
  return job ? NextResponse.json(toView(job)) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
