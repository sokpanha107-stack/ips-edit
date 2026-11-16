import type { SupabaseClient } from '@supabase/supabase-js';

export interface PromptRow { id: string; title: string; content: string; created_at: string }
export type PromptSummary = Omit<PromptRow, 'content'> & { chars: number; preview: string };

const ok = <T,>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };

/** All functions take the user's own client, so Row Level Security (auth.uid() = user_id) decides what is visible. */
export async function listPrompts(db: SupabaseClient): Promise<PromptSummary[]> {
  const rows = ok(await db.from('prompt_vault').select('id,title,created_at,content').order('created_at', { ascending: false }).limit(500)) as PromptRow[];
  return rows.map((r) => ({ id: r.id, title: r.title, created_at: r.created_at, chars: r.content.length, preview: r.content.slice(0, 160).replace(/\s+/g, ' ') }));
}
export async function getPrompt(db: SupabaseClient, id: string): Promise<PromptRow | null> {
  return (ok(await db.from('prompt_vault').select('*').eq('id', id).maybeSingle()) as PromptRow | null) ?? null;
}
export async function createPrompt(db: SupabaseClient, userId: string, title: string, content: string): Promise<PromptRow> {
  return ok(await db.from('prompt_vault').insert({ user_id: userId, title, content }).select('*').single()) as PromptRow;
}
export async function updatePrompt(db: SupabaseClient, id: string, title: string, content: string): Promise<PromptRow | null> {
  return (ok(await db.from('prompt_vault').update({ title, content }).eq('id', id).select('*').maybeSingle()) as PromptRow | null) ?? null;
}
export async function deletePrompt(db: SupabaseClient, id: string): Promise<void> {
  ok(await db.from('prompt_vault').delete().eq('id', id));
}
