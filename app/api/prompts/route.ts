import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAccess } from '@/lib/backend/auth';
import { createPrompt, listPrompts, promptsPersistent } from '@/lib/backend/prompts';

export const dynamic = 'force-dynamic';
const body = z.object({ title: z.string().trim().min(1).max(200), content: z.string().min(1).max(400000) });

export async function GET(req: Request) {
  const denied = requireAccess(req); if (denied) return denied;
  try { return NextResponse.json({ persistent: promptsPersistent(), prompts: await listPrompts() }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}

export async function POST(req: Request) {
  const denied = requireAccess(req); if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Title (1-200 chars) and content (up to 400,000 chars) are required.' }, { status: 400 });
  try { return NextResponse.json({ prompt: await createPrompt(parsed.data.title, parsed.data.content) }, { status: 201 }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}
