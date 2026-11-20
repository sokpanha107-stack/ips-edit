-- Atom Edit v2.4 (run once in Supabase → SQL editor). Optional but recommended: lets the app show/keep GPU job history.
create table if not exists public.gpu_jobs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image','music','video')),
  title text not null,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  step integer, total integer, detail text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.gpu_jobs enable row level security;
alter table public.gpu_jobs force row level security;
revoke all on table public.gpu_jobs from anon, public;
grant select, insert, update, delete on table public.gpu_jobs to authenticated;
drop policy if exists "gpu_jobs_own" on public.gpu_jobs;
create policy "gpu_jobs_own" on public.gpu_jobs for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
