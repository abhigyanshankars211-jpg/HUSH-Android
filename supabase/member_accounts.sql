-- Email members can join beside anonymous login.
-- Also fixes the active-member count.
-- Run once in the Supabase SQL Editor.

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

create or replace function public.pulse_online()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    update public.profiles set last_seen = now() where id = auth.uid();
  end if;
  return public.online_count();
end;
$$;

create or replace function public.hush_block_closed_signups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.signups_enabled() then
    return new;
  end if;
  if exists (select 1 from public.admin_users where user_id = new.id) then
    return new;
  end if;
  raise exception 'New members are paused';
end;
$$;

revoke all on function public.online_count() from public;
grant execute on function public.online_count() to anon, authenticated;
revoke all on function public.pulse_online() from public;
grant execute on function public.pulse_online() to authenticated;
