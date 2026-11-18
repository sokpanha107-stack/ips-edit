import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/backend/session';
import { getCredential } from '@/lib/backend/vault';
import { aboutAsText } from '@/lib/about';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const body = z.object({
  message: z.string().trim().max(4000).default(''),
  screen: z.string().max(60).default('app'),
  language: z.enum(['kh', 'en']).default('kh'),
  /** data URL of a screenshot (png/jpeg/webp), max ~4 MB */
  image: z.string().max(6_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'model']), text: z.string().max(4000) })).max(12).default([]),
});

const LIMIT = () => Math.max(1, Number(process.env.AI_DAILY_QUOTA) || 100);
const BUFFER = () => { const b = Number(process.env.AI_QUOTA_BUFFER); return b > 0 && b <= 1 ? b : 0.98; };
const MODEL = () => (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/[^a-z0-9.\-]/gi, '');

async function usage(db: import('@supabase/supabase-js').SupabaseClient, userId: string) {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await db.from('ai_usage').select('calls').eq('user_id', userId).eq('day', day).maybeSingle();
  return { day, calls: Number((data as { calls?: number } | null)?.calls ?? 0) };
}

/** GET → current usage so the UI can show the meter. */
export async function GET() {
  const au = await requireUser(); if ('res' in au) return au.res;
  const u = await usage(au.ctx.db, au.ctx.userId);
  return NextResponse.json({ used: u.calls, limit: LIMIT(), percent: Math.round((u.calls / LIMIT()) * 100), buffer: BUFFER() });
}

export async function POST(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.message && !parsed.data.image)) return NextResponse.json({ error: 'Empty or invalid request' }, { status: 400 });
  const { message, screen, language, image, history } = parsed.data;

  // Safety buffer: stop BEFORE the real limit is hit (default 98%).
  const u = await usage(au.ctx.db, au.ctx.userId);
  if (u.calls + 1 > Math.floor(LIMIT() * BUFFER())) {
    return NextResponse.json({ error: 'quota', code: 'QUOTA_BUFFER', used: u.calls, limit: LIMIT(), percent: Math.round((u.calls / LIMIT()) * 100), buffer: BUFFER() }, { status: 429 });
  }

  const cred = await getCredential(au.ctx.db, au.ctx.userId, 'gemini').catch(() => null);
  if (!cred?.key) return NextResponse.json({ error: 'no_key' }, { status: 400 });

  const system = `You are the in-app assistant of "Atom Edit". Answer ONLY using the manual below; if something is not covered, say so briefly and suggest the closest feature. `
    + `Reply in ${language === 'kh' ? 'Khmer (about 98%, keep technical terms in English)' : 'English'}. Give clear numbered step-by-step help. Never ask for or repeat secret keys. The user is currently on the "${screen}" screen.\n\n=== MANUAL ===\n${aboutAsText()}`;
  const parts: unknown[] = [];
  if (image) { const m = image.match(/^data:(image\/[a-z]+);base64,(.*)$/s); if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } }); }
  parts.push({ text: message || (language === 'kh' ? 'សូមពន្យល់អំពីរូបនេះ' : 'Please explain this screenshot.') });

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(50000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cred.key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })), { role: 'user', parts }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
      }),
    });
    if (r.status === 429) return NextResponse.json({ error: 'quota', code: 'PROVIDER_LIMIT', used: u.calls, limit: LIMIT(), percent: 100, buffer: BUFFER() }, { status: 429 });
    if (!r.ok) return NextResponse.json({ error: `Gemini error ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}` }, { status: 502 });
    const j = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
    if (!text) return NextResponse.json({ error: 'Gemini returned no answer.' }, { status: 502 });
    // Count only successful calls.
    await au.ctx.db.from('ai_usage').upsert({ user_id: au.ctx.userId, day: u.day, calls: u.calls + 1 }, { onConflict: 'user_id,day' });
    return NextResponse.json({ text, used: u.calls + 1, limit: LIMIT(), percent: Math.round(((u.calls + 1) / LIMIT()) * 100) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gemini unreachable' }, { status: 502 });
  }
}
