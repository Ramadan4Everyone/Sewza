-- SEWZA Work Gallery / Tailor Portfolio
-- Run this ONCE in Supabase -> SQL Editor. It is safe to run again.

-- 1) One public portfolio per tailor
create table if not exists public.tailor_portfolios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  slug text not null,
  business_name text not null default '',
  tagline text not null default '',
  about text not null default '',
  location text not null default '',
  whatsapp text not null default '',
  logo_url text,
  socials jsonb not null default '{}'::jsonb,
  specialties jsonb not null default '[]'::jsonb,
  works jsonb not null default '[]'::jsonb,
  published boolean not null default false,
  views integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tailor_portfolios_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$')
);

create unique index if not exists tailor_portfolios_slug_key on public.tailor_portfolios (slug);

alter table public.tailor_portfolios enable row level security;

-- the tailor manages their own portfolio
drop policy if exists portfolios_owner on public.tailor_portfolios;
create policy portfolios_owner on public.tailor_portfolios
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- anyone (customers, no login) can read portfolios that are published
drop policy if exists portfolios_public_read on public.tailor_portfolios;
create policy portfolios_public_read on public.tailor_portfolios
  for select to anon, authenticated using (published = true);

-- 2) Counts a visit to a published portfolio (lets the tailor see "views")
create or replace function public.portfolio_track(p_slug text)
returns void language sql security definer set search_path = public as $$
  update public.tailor_portfolios set views = views + 1
  where slug = lower(p_slug) and published = true;
$$;
grant execute on function public.portfolio_track(text) to anon, authenticated;

-- 3) Lets the editor tell the tailor whether a link name is still free
create or replace function public.portfolio_slug_available(p_slug text)
returns boolean language sql security definer stable set search_path = public as $$
  select not exists (
    select 1 from public.tailor_portfolios
    where slug = lower(p_slug)
      and user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  );
$$;
grant execute on function public.portfolio_slug_available(text) to authenticated;

-- 4) Storage bucket for portfolio photos and logos (public so customers can see them)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio-media', 'portfolio-media', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists portfolio_media_select on storage.objects;
create policy portfolio_media_select on storage.objects for select to authenticated
using (bucket_id = 'portfolio-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists portfolio_media_insert on storage.objects;
create policy portfolio_media_insert on storage.objects for insert to authenticated
with check (bucket_id = 'portfolio-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists portfolio_media_update on storage.objects;
create policy portfolio_media_update on storage.objects for update to authenticated
using (bucket_id = 'portfolio-media' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'portfolio-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists portfolio_media_delete on storage.objects;
create policy portfolio_media_delete on storage.objects for delete to authenticated
using (bucket_id = 'portfolio-media' and (storage.foldername(name))[1] = auth.uid()::text);
