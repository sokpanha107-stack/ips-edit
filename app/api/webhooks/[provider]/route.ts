import { NextResponse } from 'next/server';
import { checkWebhookToken } from '@/lib/backend/auth';
import { applyResult, tick } from '@/lib/backend/engine';
import { getProvider } from '@/lib/backend/providers';
import { getStore } from '@/lib/backend/store';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Providers call this when a scene finishes, even if the app is closed. It also submits the next queued scenes. */
export async function POST(req: Request, { params }: { params: { provider: string } }) {
  const url = new URL(req.url);
  if (!checkWebhookToken(url.searchParams.get('token'))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const jobId = url.searchParams.get('job') ?? '';
  const idx = Number(url.searchParams.get('scene'));
  let provider;
  try { provider = getProvider(params.provider); } catch { return NextResponse.json({ error: 'unknown provider' }, { status: 404 }); }
  if (!provider.parseWebhook) return NextResponse.json({ error: 'provider has no webhook' }, { status: 400 });

  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'server not configured' }, { status: 503 });
  const job = await getStore(admin).getJob(jobId);   // service role: no user session in a webhook, so the job's own user_id is used below
  const scene = job?.scenes[idx];
  if (!job?.userId) return NextResponse.json({ error: 'unknown job' }, { status: 404 });
  const ctx = { db: admin, userId: job.userId };
  if (!job || !scene) return NextResponse.json({ error: 'unknown scene' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (scene.status === 'running') await applyResult(ctx, jobId, scene, provider.parseWebhook(body));
  await tick(ctx, jobId);
  return NextResponse.json({ ok: true });
}
