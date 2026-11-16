import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fileOutputs } from '@/lib/backend/outputs';
import { requireUser } from '@/lib/backend/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const body = z.object({
  kind: z.enum(['image', 'voice', 'video']),
  title: z.string().trim().min(1).max(100),
  items: z.array(z.object({ name: z.string().trim().min(1).max(120), url: z.string().url().max(2000) })).min(1).max(100),
});

/**
 * For jobs the browser runs straight against the GPU worker (Image Engine, Timeline render): once they finish, the PWA calls this.
 * We copy the files into a new Document folder and push the "complete" notification.
 */
export async function POST(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  try { return NextResponse.json({ ok: true, ...(await fileOutputs(au.ctx, parsed.data)) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}
