-- One-time fix: lets the API Key Vault save Gemini (and any future service).
alter table public.api_keys drop constraint if exists api_keys_service_name_check;
alter table public.api_keys add constraint api_keys_service_name_check check (service_name ~ '^[a-z_]{2,40}$');

create table if not exists public.ai_usage (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day     date not null default (now() at time zone 'utc')::date,
  calls   integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;
revoke all on table public.ai_usage from anon, public;
grant select, insert, update, delete on table public.ai_usage to authenticated;
drop policy if exists "ai_usage_select_own" on public.ai_usage;
drop policy if exists "ai_usage_insert_own" on public.ai_usage;
drop policy if exists "ai_usage_update_own" on public.ai_usage;
drop policy if exists "ai_usage_delete_own" on public.ai_usage;
create policy "ai_usage_select_own" on public.ai_usage for select to authenticated using (auth.uid() = user_id);
create policy "ai_usage_insert_own" on public.ai_usage for insert to authenticated with check (auth.uid() = user_id);
create policy "ai_usage_update_own" on public.ai_usage for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ai_usage_delete_own" on public.ai_usage for delete to authenticated using (auth.uid() = user_id);
