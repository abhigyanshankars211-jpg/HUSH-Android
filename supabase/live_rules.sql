-- App-wide 5 minute vanish, photo views, and device ban.
-- Run once in the Supabase SQL Editor. Nothing is dropped.

insert into public.app_settings(key, value)
values ('vanish_5m', 'true'::jsonb)
on conflict (key) do nothing;

alter table public.profiles add column if not exists last_seen timestamptz;
alter table public.posts add column if not exists view_count integer not null default 0;
alter table public.tic_games add column if not exists invited uuid;

create table if not exists public.post_views (
  post_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_views enable row level security;
revoke all on table public.post_views from public, anon, authenticated;

create table if not exists public.user_devices (
  user_id uuid not null,
  device_id text not null,
  last_seen timestamptz not null default now(),
  primary key (user_id, device_id)
);
alter table public.user_devices enable row level security;
revoke all on table public.user_devices from public, anon, authenticated;

create table if not exists public.banned_devices (
  device_id text primary key,
  user_id uuid,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.banned_devices enable row level security;
revoke all on table public.banned_devices from public, anon, authenticated;

update storage.buckets
set file_size_limit = 2097152
where id in ('pic-wall', 'chat-media');

create or replace function public.vanish_enabled()
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
    from public.app_settings where key = 'vanish_5m'),
    true
  );
$$;

create or replace function public.set_vanish_enabled(enabled boolean)
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
  values ('vanish_5m', to_jsonb(enabled), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return enabled;
end;
$$;

create or replace function public.purge_vanished()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.vanish_enabled() is not true then
    return;
  end if;
  begin
    delete from storage.objects o
    using (
      select image_path as name from public.messages
      where created_at < now() - interval '5 minutes' and image_path is not null
      union
      select image_path from public.group_messages
      where created_at < now() - interval '5 minutes' and image_path is not null
    ) old
    where o.bucket_id = 'chat-media' and o.name = old.name;
  exception when others then
    null;
  end;
  delete from public.messages where created_at < now() - interval '5 minutes';
  delete from public.group_messages where created_at < now() - interval '5 minutes';
  delete from public.comments where created_at < now() - interval '5 minutes';
end;
$$;

create or replace function public.record_post_view(pid uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  inserted integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  insert into public.post_views(post_id, user_id)
  values (pid, auth.uid())
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted > 0 then
    update public.posts
    set view_count = coalesce(view_count, 0) + 1
    where id = pid
    returning view_count into n;
  else
    select view_count into n from public.posts where id = pid;
  end if;
  return coalesce(n, 0);
end;
$$;

create or replace function public.device_blocked(device_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.banned_devices
    where banned_devices.device_id = device_blocked.device_id
  );
$$;

create or replace function public.register_device(device_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  blocked boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if device_id is null or length(trim(device_id)) < 8 or length(device_id) > 80 then
    raise exception 'Bad device';
  end if;
  insert into public.user_devices(user_id, device_id, last_seen)
  values (auth.uid(), device_id, now())
  on conflict (user_id, device_id) do update set last_seen = now();
  update public.profiles set last_seen = now() where id = auth.uid();
  blocked := public.device_blocked(device_id);
  if blocked then
    insert into public.banned_users(user_id, reason)
    select auth.uid(), 'Banned device'
    where not exists (
      select 1 from public.banned_users where user_id = auth.uid()
    );
  end if;
  return blocked;
end;
$$;

create or replace function public.hush_sync_device_ban()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.banned_devices(device_id, user_id, reason)
    select device_id, new.user_id, coalesce(new.reason, 'Banned')
    from public.user_devices
    where user_id = new.user_id
    on conflict (device_id) do update
      set user_id = excluded.user_id, reason = excluded.reason;
    return null;
  end if;
  delete from public.banned_devices where user_id = old.user_id;
  return null;
end;
$$;

drop trigger if exists hush_sync_device_ban on public.banned_users;
create trigger hush_sync_device_ban
  after insert or delete on public.banned_users
  for each row execute function public.hush_sync_device_ban();

create or replace function public.list_game_members()
returns table(id uuid, username text, open_code text, challenge_code text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username,
    (
      select g.code from public.tic_games g
      where g.player_x = p.id and g.status = 'waiting'
        and (g.invited is null or g.invited = auth.uid())
      order by g.created_at desc limit 1
    ) as open_code,
    (
      select g.code from public.tic_games g
      where g.player_x = p.id and g.invited = auth.uid() and g.status = 'waiting'
      order by g.created_at desc limit 1
    ) as challenge_code
  from public.profiles p
  where p.id <> auth.uid()
    and p.last_seen > now() - interval '3 minutes'
    and not exists (select 1 from public.banned_users b where b.user_id = p.id)
  order by p.username;
$$;

create or replace function public.create_tic_challenge(invite uuid)
returns public.tic_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.tic_games;
  c text;
  n int := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if invite is null or invite = auth.uid() then
    raise exception 'Choose another member';
  end if;
  select * into g
  from public.tic_games
  where player_x = auth.uid() and invited = invite and status = 'waiting'
  order by created_at desc
  limit 1;
  if found then
    return g;
  end if;
  loop
    n := n + 1;
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
    begin
      insert into public.tic_games(code, player_x, invited)
      values (c, auth.uid(), invite)
      returning * into g;
      return g;
    exception when unique_violation then
      if n >= 5 then
        raise exception 'Could not start a game. Try again.';
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.vanish_enabled() from public;
grant execute on function public.vanish_enabled() to authenticated;
revoke all on function public.set_vanish_enabled(boolean) from public;
grant execute on function public.set_vanish_enabled(boolean) to authenticated;
revoke all on function public.purge_vanished() from public;
grant execute on function public.purge_vanished() to authenticated;
revoke all on function public.record_post_view(uuid) from public;
grant execute on function public.record_post_view(uuid) to authenticated;
revoke all on function public.device_blocked(text) from public;
grant execute on function public.device_blocked(text) to anon, authenticated;
revoke all on function public.register_device(text) from public;
grant execute on function public.register_device(text) to authenticated;
revoke all on function public.list_game_members() from public;
grant execute on function public.list_game_members() to authenticated;
revoke all on function public.create_tic_challenge(uuid) from public;
grant execute on function public.create_tic_challenge(uuid) to authenticated;
