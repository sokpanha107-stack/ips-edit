import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAccess } from '@/lib/backend/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ text: z.string().min(1).max(3000), from: z.enum(['km', 'en']), to: z.enum(['km', 'en']) });
const CODES: Record<string, string[]> = { km: ['km', 'km-KH'], en: ['en', 'en-US'] };
const MAX_BYTES = 450;   // MyMemory accepts at most 500 bytes per request; Khmer letters are 3 bytes each

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Cut one line into pieces of at most MAX_BYTES, preferring sentence ends, then spaces. */
function pieces(line: string): string[] {
  if (bytes(line) <= MAX_BYTES) return [line];
  const out: string[] = [];
  let cur = '';
  for (const part of line.split(/(?<=[。.!?។៕])\s*|\s+/u)) {
    const next = cur ? `${cur} ${part}` : part;
    if (bytes(next) <= MAX_BYTES) { cur = next; continue; }
    if (cur) out.push(cur);
    cur = '';
    for (const ch of Array.from(part)) { if (bytes(cur + ch) > MAX_BYTES) { out.push(cur); cur = ''; } cur += ch; }
  }
  if (cur) out.push(cur);
  return out;
}

async function translateChunk(q: string, from: string, to: string): Promise<string> {
  let lastError = 'Translation failed';
  for (const f of CODES[from]) for (const t of CODES[to]) {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', q);
    url.searchParams.set('langpair', `${f}|${t}`);
    if (process.env.MYMEMORY_EMAIL) url.searchParams.set('de', process.env.MYMEMORY_EMAIL);
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => null);
    const text: string = data?.responseData?.translatedText ?? '';
    if (data && Number(data.responseStatus) === 200 && text && !/MYMEMORY WARNING/i.test(text)) return decode(text);
    lastError = /MYMEMORY WARNING|ALL AVAILABLE FREE/i.test(text) || Number(data?.responseStatus) === 429 ? 'quota' : String(data?.responseDetails || text || lastError).slice(0, 160);
    if (lastError === 'quota') throw new Error('quota');
  }
  throw new Error(lastError);
}

/** Khmer <-> English through the free MyMemory service (no key). Quality for Khmer is basic: always proofread. */
export async function POST(req: Request) {
  const denied = requireAccess(req);
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid request' }, { status: 400 });
  const { text, from, to } = parsed.data;
  if (from === to) return NextResponse.json({ ok: true, text });
  try {
    const lines = text.replace(/\r/g, '').split('\n');
    const out: string[] = [];
    for (const line of lines) {
      if (!line.trim()) { out.push(''); continue; }
      const done: string[] = [];
      for (const p of pieces(line.trim())) done.push(await translateChunk(p, from, to));
      out.push(done.join(' '));
    }
    return NextResponse.json({ ok: true, text: out.join('\n') });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed';
    return NextResponse.json({ ok: false, error: msg === 'quota' ? 'quota' : msg });
  }
}
