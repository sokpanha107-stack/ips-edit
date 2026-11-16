import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/backend/session';
import { createPrompt, listPrompts } from '@/lib/backend/prompts';

export const dynamic = 'force-dynamic';
const body = z.object({ title: z.string().trim().min(1).max(200), content: z.string().min(1).max(400000) });

export async function GET(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res; const me = au.ctx;
  try { return NextResponse.json({ persistent: true, prompts: await listPrompts(me.db) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}

export async function POST(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res; const me = au.ctx;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Title (1-200 chars) and content (up to 400,000 chars) are required.' }, { status: 400 });
  try { return NextResponse.json({ prompt: await createPrompt(me.db, me.userId, parsed.data.title, parsed.data.content) }, { status: 201 }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}
