-- SEWZA push notifications — run once in the Supabase SQL Editor.
-- Safe to re-run. Does not touch any existing table.

-- 1) Devices that have switched notifications on ---------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions for delete using (user_id = auth.uid());
-- (inserts/updates go through the register_push_subscription() function below)

-- 2) Which alerts each user wants ------------------------------------------------
create table if not exists public.push_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  types jsonb not null default '{}'::jsonb,
  reminder_time text not null default '08:00' check (reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text not null default 'Africa/Lagos',
  updated_at timestamptz not null default now()
);
alter table public.push_prefs enable row level security;
drop policy if exists push_prefs_own on public.push_prefs;
create policy push_prefs_own on public.push_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3) Remembers what was already sent so nobody is notified twice -----------------
create table if not exists public.push_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.push_log enable row level security;   -- no policies: only the server (service role) uses it

-- 4) SEWZA announcements. Insert a row and it is sent to everyone who allows them --
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'SEWZA announcement',
  body text not null,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.announcements enable row level security;  -- no policies: only you (SQL editor) and the server

-- 5) Functions used by the app ----------------------------------------------------
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth_key = excluded.auth_key,
        user_agent = excluded.user_agent, updated_at = now();
end $$;

create or replace function public.unregister_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

revoke all on function public.register_push_subscription(text,text,text,text) from public;
revoke all on function public.unregister_push_subscription(text) from public;
grant execute on function public.register_push_subscription(text,text,text,text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to anon, authenticated;

-- 6) Schedule (see PUSH_SETUP.md step 5). Replace YOUR_CRON_SECRET, then run:
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.schedule('sewza-push-tick', '*/15 * * * *', $$
--   select net.http_post(
--     url := 'https://agzumrttzqjxcpewdbyg.supabase.co/functions/v1/sewza-push',
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','YOUR_CRON_SECRET'),
--     body := '{"action":"tick"}'::jsonb
--   );
-- $$);
