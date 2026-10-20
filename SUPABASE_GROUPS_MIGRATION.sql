-- SEWZA group orders cloud storage
-- Run this ONCE in Supabase -> SQL Editor. It is safe to run again.

create table if not exists public.customer_groups (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists customer_groups_user_id_idx on public.customer_groups(user_id);

alter table public.customer_groups enable row level security;

drop policy if exists customer_groups_own on public.customer_groups;
create policy customer_groups_own on public.customer_groups
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
