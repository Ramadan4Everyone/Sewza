-- SEWZA Portfolio Upgrade: page settings + customer-only reviews
-- Run this ONCE in Supabase -> SQL Editor, AFTER SUPABASE_PORTFOLIO_MIGRATION.sql. It is safe to run again.
-- It only ADDS things. Nothing that already exists is changed or removed.

-- 1) Extra look-and-feel settings for each portfolio (colour theme, hero photo, services, FAQ, WhatsApp chat button ...)
alter table public.tailor_portfolios
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- 2) Customer reviews.
--    A review can ONLY be created by a customer, through portfolio_submit_review() below.
--    The tailor can approve, hide, reply to or delete reviews, but can never write or edit one.
create table if not exists public.portfolio_reviews (
  id uuid primary key default gen_random_uuid(),
  portfolio_user_id uuid not null references public.tailor_portfolios(user_id) on delete cascade,
  reviewer_name text not null,
  rating smallint not null,
  comment text not null default '',
  status text not null default 'pending',
  owner_reply text not null default '',
  device_key text,
  created_at timestamptz not null default now(),
  constraint portfolio_reviews_rating_range check (rating between 1 and 5),
  constraint portfolio_reviews_status_valid check (status in ('pending', 'approved', 'hidden')),
  constraint portfolio_reviews_name_len check (char_length(reviewer_name) between 2 and 60),
  constraint portfolio_reviews_comment_len check (char_length(comment) <= 600),
  constraint portfolio_reviews_reply_len check (char_length(owner_reply) <= 400)
);

create index if not exists portfolio_reviews_lookup_idx
  on public.portfolio_reviews (portfolio_user_id, status, created_at desc);

-- one review per customer device per portfolio (best-effort protection against repeat submissions)
create unique index if not exists portfolio_reviews_device_once
  on public.portfolio_reviews (portfolio_user_id, device_key) where device_key is not null;

alter table public.portfolio_reviews enable row level security;

-- Visitors (no login) can read APPROVED reviews of PUBLISHED portfolios
drop policy if exists portfolio_reviews_public_read on public.portfolio_reviews;
create policy portfolio_reviews_public_read on public.portfolio_reviews
  for select to anon, authenticated
  using (
    status = 'approved'
    and exists (
      select 1 from public.tailor_portfolios p
      where p.user_id = portfolio_reviews.portfolio_user_id and p.published = true
    )
  );

-- The tailor can see every review left on their own portfolio (including waiting ones)
drop policy if exists portfolio_reviews_owner_read on public.portfolio_reviews;
create policy portfolio_reviews_owner_read on public.portfolio_reviews
  for select to authenticated using (portfolio_user_id = auth.uid());

drop policy if exists portfolio_reviews_owner_update on public.portfolio_reviews;
create policy portfolio_reviews_owner_update on public.portfolio_reviews
  for update to authenticated
  using (portfolio_user_id = auth.uid()) with check (portfolio_user_id = auth.uid());

drop policy if exists portfolio_reviews_owner_delete on public.portfolio_reviews;
create policy portfolio_reviews_owner_delete on public.portfolio_reviews
  for delete to authenticated using (portfolio_user_id = auth.uid());

-- No INSERT policy exists on purpose. Column-level grants stop the tailor from changing
-- a customer's name, stars or comment: they may only change the status and add a reply.
revoke all on public.portfolio_reviews from anon, authenticated;
grant select on public.portfolio_reviews to anon, authenticated;
grant update (status, owner_reply) on public.portfolio_reviews to authenticated;
grant delete on public.portfolio_reviews to authenticated;

-- 3) How a customer sends a review from the public portfolio page.
--    New reviews wait for the tailor's approval before they appear on the page.
create or replace function public.portfolio_submit_review(
  p_slug text, p_name text, p_rating integer, p_comment text, p_device text default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_comment text := btrim(coalesce(p_comment, ''));
  v_dev text := nullif(left(btrim(coalesce(p_device, '')), 64), '');
begin
  select user_id into v_uid from public.tailor_portfolios
    where slug = lower(coalesce(p_slug, '')) and published = true;
  if v_uid is null then return 'not_found'; end if;
  if auth.uid() is not null and auth.uid() = v_uid then return 'own'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then return 'invalid_name'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then return 'invalid_rating'; end if;
  if char_length(v_comment) < 10 or char_length(v_comment) > 600 then return 'invalid_comment'; end if;
  if v_dev is not null and exists (
    select 1 from public.portfolio_reviews where portfolio_user_id = v_uid and device_key = v_dev
  ) then return 'duplicate'; end if;
  if (select count(*) from public.portfolio_reviews
      where portfolio_user_id = v_uid and created_at > now() - interval '1 day') >= 40 then
    return 'busy';
  end if;
  insert into public.portfolio_reviews (portfolio_user_id, reviewer_name, rating, comment, device_key)
  values (v_uid, v_name, p_rating::smallint, v_comment, v_dev);
  return 'ok';
end;
$$;
grant execute on function public.portfolio_submit_review(text, text, integer, text, text) to anon, authenticated;
