-- ════════════════════════════════════════════════════════════════════
--  Atom Edit · multi-tenant schema with strict Row Level Security
--  Run once: Supabase → SQL Editor → New query → paste everything → Run.
--  Safe to run again (idempotent). Every table has user_id and the rule
--  auth.uid() = user_id for select / insert / update / delete.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Tables ────────────────────────────────────────────────────────
create table if not exists public.ips_jobs (
  id            text primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  engine        text not null check (engine in ('video','kh','en')),
  folder        text not null,
  master_prompt text not null,
  provider      text not null,
  image_url     text,
  voice_id      text,
  options       jsonb not null default '{}'::jsonb,
  cancelled     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.ips_scenes (
  job_id      text not null references public.ips_jobs(id) on delete cascade,
  idx         integer not null,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  prompt      text not null,
  status      text not null default 'queued',
  external_id text,
  meta        jsonb,
  output_url  text,
  error       text,
  attempts    integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (job_id, idx)
);

create table if not exists public.prompt_vault (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  content     text not null check (char_length(content) between 1 and 400000),
  created_at  timestamptz not null default now()
);

-- API Key Vault: the key is stored ENCRYPTED (AES-256-GCM, done by the server). The browser never receives it back.
create table if not exists public.api_keys (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  service_name    text not null check (service_name ~ '^[a-z_]{2,40}$'),   -- which services are allowed is enforced by the server, so new ones never need a migration
  key_cipher      text not null,
  key_hint        text not null default '',
  endpoint        text,
  last_status     text check (last_status in ('connected','failed')),
  last_checked_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, service_name)
);

-- "Document" file manager: one row per folder / file / zip. The bytes live in Storage bucket "documents".
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id    uuid references public.documents(id) on delete cascade,
  kind         text not null check (kind in ('folder','file','zip')),
  name         text not null check (char_length(name) between 1 and 200),
  storage_path text,
  mime         text,
  size_bytes   bigint not null default 0,
  source       text check (source in ('upload','image','voice','video')),
  created_at   timestamptz not null default now(),
  check ((kind = 'folder') = (storage_path is null))
);
create index if not exists documents_user_parent_idx on public.documents (user_id, parent_id, created_at desc);

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  subscription jsonb not null,            -- the full PushSubscription JSON (endpoint + keys.p256dh + keys.auth)
  user_agent   text,
  created_at   timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- AI Assistant usage counter (one row per user per UTC day) for the 98% safety buffer.
create table if not exists public.ai_usage (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day     date not null default (now() at time zone 'utc')::date,
  calls   integer not null default 0,
  primary key (user_id, day)
);

-- ── 1b. Upgrade from the old single-user schema (no-op on a fresh project) ──
alter table public.ips_jobs     add column if not exists user_id uuid default auth.uid() references auth.users(id) on delete cascade;
alter table public.ips_scenes   add column if not exists user_id uuid default auth.uid() references auth.users(id) on delete cascade;
alter table public.prompt_vault add column if not exists user_id uuid default auth.uid() references auth.users(id) on delete cascade;
create index if not exists ips_jobs_user_created_idx on public.ips_jobs (user_id, created_at desc);
create index if not exists prompt_vault_user_created_idx on public.prompt_vault (user_id, created_at desc);

-- A document's parent folder must belong to the same user (blocks writing into someone else's folder).
create or replace function public.documents_same_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.documents p where p.id = new.parent_id and p.user_id = new.user_id and p.kind = 'folder'
  ) then
    raise exception 'parent folder not found';
  end if;
  return new;
end $$;
drop trigger if exists documents_same_owner_trg on public.documents;
create trigger documents_same_owner_trg before insert or update of parent_id, user_id on public.documents
  for each row execute function public.documents_same_owner();

-- Existing projects: replace the old fixed list with a format-only check (the server validates the service name).
alter table public.api_keys drop constraint if exists api_keys_service_name_check;
alter table public.api_keys add constraint api_keys_service_name_check check (service_name ~ '^[a-z_]{2,40}$');

-- ── 2. Row Level Security: owner-only on EVERY table ─────────────────
do $$
declare t text;
begin
  foreach t in array array['ips_jobs','ips_scenes','prompt_vault','api_keys','documents','push_subscriptions','ai_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);

    execute format('drop policy if exists "%1$s_select_own" on public.%1$I', t);
    execute format('drop policy if exists "%1$s_insert_own" on public.%1$I', t);
    execute format('drop policy if exists "%1$s_update_own" on public.%1$I', t);
    execute format('drop policy if exists "%1$s_delete_own" on public.%1$I', t);

    execute format('create policy "%1$s_select_own" on public.%1$I for select to authenticated using (auth.uid() = user_id)', t);
    execute format('create policy "%1$s_insert_own" on public.%1$I for insert to authenticated with check (auth.uid() = user_id)', t);
    execute format('create policy "%1$s_update_own" on public.%1$I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy "%1$s_delete_own" on public.%1$I for delete to authenticated using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- ── 3. Storage: private bucket "documents", each user only inside folder "<their uid>/" ──
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 524288000)      -- 500 MB per file
on conflict (id) do update set public = false, file_size_limit = 524288000;

drop policy if exists "documents_obj_select_own" on storage.objects;
drop policy if exists "documents_obj_insert_own" on storage.objects;
drop policy if exists "documents_obj_update_own" on storage.objects;
drop policy if exists "documents_obj_delete_own" on storage.objects;
create policy "documents_obj_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents_obj_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents_obj_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents_obj_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
