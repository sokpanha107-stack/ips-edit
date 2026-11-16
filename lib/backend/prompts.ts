import { randomUUID } from 'crypto';
import { getSupabase } from './store';

export interface PromptRow { id: string; title: string; content: string; created_at: string }
export type PromptSummary = Omit<PromptRow, 'content'> & { chars: number; preview: string };

const summarize = (r: PromptRow): PromptSummary => ({ id: r.id, title: r.title, created_at: r.created_at, chars: r.content.length, preview: r.content.slice(0, 140).replace(/\s+/g, ' ') });

/** Persistent in Supabase (table prompt_vault). Without Supabase it falls back to server memory, which can vanish: the UI shows a warning. */
const g = globalThis as unknown as { __ipsPrompts?: Map<string, PromptRow> };
const mem = () => (g.__ipsPrompts ??= new Map());

export const promptsPersistent = () => !!getSupabase();

export async function listPrompts(): Promise<PromptSummary[]> {
  const db = getSupabase();
  if (!db) return Array.from(mem().values()).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(summarize);
  const { data, error } = await db.from('prompt_vault').select('id,title,content,created_at').order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error(`supabase: ${error.message}`);
  return (data as PromptRow[]).map(summarize);
}

export async function getPrompt(id: string): Promise<PromptRow | null> {
  const db = getSupabase();
  if (!db) return mem().get(id) ?? null;
  const { data, error } = await db.from('prompt_vault').select('id,title,content,created_at').eq('id', id).maybeSingle();
  if (error) throw new Error(`supabase: ${error.message}`);
  return (data as PromptRow | null) ?? null;
}

export async function createPrompt(title: string, content: string): Promise<PromptRow> {
  const db = getSupabase();
  if (!db) { const row = { id: randomUUID(), title, content, created_at: new Date().toISOString() }; mem().set(row.id, row); return row; }
  const { data, error } = await db.from('prompt_vault').insert({ title, content }).select('id,title,content,created_at').single();
  if (error) throw new Error(`supabase: ${error.message}`);
  return data as PromptRow;
}

export async function updatePrompt(id: string, title: string, content: string): Promise<PromptRow | null> {
  const db = getSupabase();
  if (!db) { const cur = mem().get(id); if (!cur) return null; const row = { ...cur, title, content }; mem().set(id, row); return row; }
  const { data, error } = await db.from('prompt_vault').update({ title, content }).eq('id', id).select('id,title,content,created_at').maybeSingle();
  if (error) throw new Error(`supabase: ${error.message}`);
  return (data as PromptRow | null) ?? null;
}

export async function deletePrompt(id: string): Promise<void> {
  const db = getSupabase();
  if (!db) { mem().delete(id); return; }
  const { error } = await db.from('prompt_vault').delete().eq('id', id);
  if (error) throw new Error(`supabase: ${error.message}`);
}
