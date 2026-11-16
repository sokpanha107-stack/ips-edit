import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/backend/session';
import { retryFailed } from '@/lib/backend/engine';
import { toView } from '@/lib/backend/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const au = await requireUser(); if ('res' in au) return au.res; const me = au.ctx;
  const job = await retryFailed(me, params.id);
  return job ? NextResponse.json(toView(job)) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
