-- HUSH secure add-on. Run once in Supabase SQL Editor.
-- Additive only: no drop of posts, profiles, messages, or existing columns.
-- Safe to run again.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings(key, value)
values ('signups_enabled', 'true'::jsonb)
on conflict (key) do nothing;

create table if not exists public.safety_words (
  word text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.ban_appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  message text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.groups add column if not exists disappear_after_hours integer;

alter table public.app_settings enable row level security;
alter table public.safety_words enable row level security;
alter table public.ban_appeals enable row level security;

revoke all on table public.app_settings from public, anon, authenticated;
revoke all on table public.safety_words from public, anon, authenticated;
revoke all on table public.ban_appeals from public, anon, authenticated;

create or replace function public.signups_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case
      when jsonb_typeof(value) = 'boolean' then (value = 'true'::jsonb)
      else value::text = 'true'
    end
    from public.app_settings where key = 'signups_enabled'),
    true
  );
$$;

create or replace function public.set_signups_enabled(enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_hush_admin() is not true then
    raise exception 'Admin only';
  end if;
  insert into public.app_settings(key, value, updated_at)
  values ('signups_enabled', to_jsonb(enabled), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return enabled;
end;
$$;

create or replace function public.hush_block_closed_signups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
begin
  if public.signups_enabled() then
    return new;
  end if;
  select email into em from auth.users where id = new.id;
  if em is null then
    raise exception 'New members are paused';
  end if;
  return new;
end;
$$;

drop trigger if exists hush_block_closed_signups on public.profiles;
create trigger hush_block_closed_signups
before insert on public.profiles
for each row execute function public.hush_block_closed_signups();

create or replace function public.list_safety_words()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(word order by word), '{}'::text[]) from public.safety_words;
$$;

create or replace function public.add_safety_word(word text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := lower(btrim(word));
begin
  if public.is_hush_admin() is not true then
    raise exception 'Admin only';
  end if;
  if clean is null or char_length(clean) < 2 or char_length(clean) > 40 then
    raise exception 'Word must be 2-40 characters';
  end if;
  insert into public.safety_words(word) values (clean) on conflict do nothing;
end;
$$;

create or replace function public.remove_safety_word(word text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_hush_admin() is not true then
    raise exception 'Admin only';
  end if;
  delete from public.safety_words where word = lower(btrim(remove_safety_word.word));
end;
$$;

create or replace function public.my_ban_appeal()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('status', status, 'message', message, 'created_at', created_at)
  from public.ban_appeals
  where user_id = auth.uid();
$$;

create or replace function public.submit_ban_appeal(msg text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing text;
  clean text := btrim(msg);
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if public.is_hush_banned() is not true then
    raise exception 'Only a banned account can appeal';
  end if;
  if clean is null or char_length(clean) < 8 then
    raise exception 'Appeal is too short';
  end if;
  select status into existing from public.ban_appeals where user_id = auth.uid();
  if existing is not null then
    return existing;
  end if;
  insert into public.ban_appeals(user_id, message) values (auth.uid(), left(clean, 500));
  return 'pending';
end;
$$;

create or replace function public.list_ban_appeals()
returns table (id uuid, user_id uuid, username text, message text, status text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_hush_admin() is not true then
    raise exception 'Admin only';
  end if;
  return query
    select a.id, a.user_id, p.username, a.message, a.status, a.created_at
    from public.ban_appeals a
    left join public.profiles p on p.id = a.user_id
    order by a.created_at desc;
end;
$$;

create or replace function public.decide_ban_appeal(appeal_id uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  if public.is_hush_admin() is not true then
    raise exception 'Admin only';
  end if;
  select user_id into uid from public.ban_appeals where id = appeal_id;
  if uid is null then
    raise exception 'Appeal not found';
  end if;
  if accept then
    delete from public.banned_users where user_id = uid;
    update public.ban_appeals set status = 'accepted' where id = appeal_id;
  else
    update public.ban_appeals set status = 'rejected' where id = appeal_id;
  end if;
end;
$$;

create or replace function public.set_group_disappear(gid uuid, turn_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_hush_admin() is not true then
    raise exception 'Admin only';
  end if;
  update public.groups
  set disappear_after_hours = case when turn_on then 24 else null end
  where id = gid;
end;
$$;

create or replace function public.sweep_group_messages(gid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if public.is_hush_admin() is not true
     and not exists (select 1 from public.group_members where group_id = gid and user_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;
  delete from public.group_messages
  where group_id = gid
    and created_at < now() - interval '24 hours'
    and exists (
      select 1 from public.groups g
      where g.id = gid and coalesce(g.disappear_after_hours, 0) > 0
    );
end;
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  delete from public.comments
  where user_id = uid or post_id in (select id from public.posts where user_id = uid);
  delete from public.post_likes
  where user_id = uid or post_id in (select id from public.posts where user_id = uid);
  delete from public.reports where reporter_id = uid;
  delete from public.posts where user_id = uid;

  delete from public.messages
  where sender_id = uid
     or conversation_id in (select id from public.conversations where user_a = uid or user_b = uid);
  delete from public.conversations where user_a = uid or user_b = uid;

  delete from public.group_messages where sender_id = uid;
  update public.groups g
  set owner_id = (
    select gm.user_id from public.group_members gm
    where gm.group_id = g.id and gm.user_id <> uid
    limit 1
  )
  where g.owner_id = uid
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = g.id and gm.user_id <> uid
    );
  delete from public.group_messages where group_id in (select id from public.groups where owner_id = uid);
  delete from public.group_members where group_id in (select id from public.groups where owner_id = uid);
  delete from public.groups where owner_id = uid;
  delete from public.group_members where user_id = uid;

  delete from public.user_blocks where blocker_id = uid or blocked_id = uid;
  delete from public.ban_appeals where user_id = uid;
  delete from public.banned_users where user_id = uid;
  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.signups_enabled() from public;
grant execute on function public.signups_enabled() to anon, authenticated;

revoke all on function public.set_signups_enabled(boolean) from public;
grant execute on function public.set_signups_enabled(boolean) to authenticated;

revoke all on function public.list_safety_words() from public;
grant execute on function public.list_safety_words() to anon, authenticated;

revoke all on function public.add_safety_word(text) from public;
grant execute on function public.add_safety_word(text) to authenticated;

revoke all on function public.remove_safety_word(text) from public;
grant execute on function public.remove_safety_word(text) to authenticated;

revoke all on function public.my_ban_appeal() from public;
grant execute on function public.my_ban_appeal() to authenticated;

revoke all on function public.submit_ban_appeal(text) from public;
grant execute on function public.submit_ban_appeal(text) to authenticated;

revoke all on function public.list_ban_appeals() from public;
grant execute on function public.list_ban_appeals() to authenticated;

revoke all on function public.decide_ban_appeal(uuid, boolean) from public;
grant execute on function public.decide_ban_appeal(uuid, boolean) to authenticated;

revoke all on function public.set_group_disappear(uuid, boolean) from public;
grant execute on function public.set_group_disappear(uuid, boolean) to authenticated;

revoke all on function public.sweep_group_messages(uuid) from public;
grant execute on function public.sweep_group_messages(uuid) to authenticated;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
