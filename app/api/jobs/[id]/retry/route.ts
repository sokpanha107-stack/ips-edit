import { NextResponse } from 'next/server';
import { requireAccess } from '@/lib/backend/auth';
import { retryFailed } from '@/lib/backend/engine';
import { toView } from '@/lib/backend/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const denied = requireAccess(req);
  if (denied) return denied;
  const job = await retryFailed(params.id);
  return job ? NextResponse.json(toView(job)) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
