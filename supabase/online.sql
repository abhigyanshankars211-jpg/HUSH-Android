-- How many members are in the app right now.
-- Run once. Safe to run again.

alter table public.profiles add column if not exists last_seen timestamptz;

create or replace function public.online_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.profiles p
  where p.last_seen > now() - interval '2 minutes'
    and not exists (
      select 1 from public.banned_users b where b.user_id = p.id
    );
$$;

revoke all on function public.online_count() from public;
grant execute on function public.online_count() to authenticated;
