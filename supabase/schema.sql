-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
create table if not exists ips_jobs (
  id            text primary key,
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

create table if not exists ips_scenes (
  job_id      text not null references ips_jobs(id) on delete cascade,
  idx         integer not null,
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

create index if not exists ips_jobs_created_idx on ips_jobs (created_at desc);

-- Only the server (service role key) touches these tables. No public policies.
alter table ips_jobs   enable row level security;
alter table ips_scenes enable row level security;

-- Prompt Library ("vault" for big master prompts). Run this in Supabase -> SQL Editor.
create table if not exists prompt_vault (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 200),
  content     text not null check (char_length(content) between 1 and 400000),
  created_at  timestamptz not null default now()
);
create index if not exists prompt_vault_created_idx on prompt_vault (created_at desc);
-- Only the server (service role key) reads/writes this table. No public policies, so the browser can never touch it directly.
alter table prompt_vault enable row level security;
