import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/backend/session';
import { deletePrompt, getPrompt, updatePrompt } from '@/lib/backend/prompts';

export const dynamic = 'force-dynamic';
const body = z.object({ title: z.string().trim().min(1).max(200), content: z.string().min(1).max(400000) });
type Ctx = { params: Promise<{ id: string }> | { id: string } };
const idOf = async (ctx: Ctx) => { const id = (await ctx.params).id; return /^[0-9a-f-]{36}$/i.test(id) ? id : null; };

export async function GET(req: Request, ctx: Ctx) {
  const au = await requireUser(); if ('res' in au) return au.res; const me = au.ctx;
  const id = await idOf(ctx); if (!id) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  try { const p = await getPrompt(me.db, id); return p ? NextResponse.json({ prompt: p }) : NextResponse.json({ error: 'not found' }, { status: 404 }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}

export async function PUT(req: Request, ctx: Ctx) {
  const au = await requireUser(); if ('res' in au) return au.res; const me = au.ctx;
  const id = await idOf(ctx); if (!id) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Title and content are required.' }, { status: 400 });
  try { const p = await updatePrompt(me.db, id, parsed.data.title, parsed.data.content); return p ? NextResponse.json({ prompt: p }) : NextResponse.json({ error: 'not found' }, { status: 404 }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const au = await requireUser(); if ('res' in au) return au.res; const me = au.ctx;
  const id = await idOf(ctx); if (!id) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  try { await deletePrompt(me.db, id); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}
