-- 24-hour delete for the whole app, including wall photos.
-- Off until an admin turns it on. Run once.

insert into public.app_settings(key, value)
values ('delete_24h', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function public.delete_24h_enabled()
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
    from public.app_settings where key = 'delete_24h'),
    false
  );
$$;

create or replace function public.set_delete_24h_enabled(enabled boolean)
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
  values ('delete_24h', to_jsonb(enabled), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return enabled;
end;
$$;

create or replace function public.sweep_expired_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  r record;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if public.delete_24h_enabled() is not true then
    return 0;
  end if;
  for r in
    select id from public.posts
    where created_at < now() - interval '24 hours'
  loop
    perform public.hush_purge_post(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.sweep_app_24h()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if public.delete_24h_enabled() is not true then
    return;
  end if;
  begin
    delete from storage.objects o
    using (
      select image_path as name from public.messages
      where created_at < now() - interval '24 hours' and image_path is not null
      union
      select image_path from public.group_messages
      where created_at < now() - interval '24 hours' and image_path is not null
      union
      select image_path from public.room_messages
      where created_at < now() - interval '24 hours' and image_path is not null
    ) old
    where o.bucket_id = 'chat-media' and o.name = old.name;
  exception when others then
    null;
  end;
  delete from public.messages where created_at < now() - interval '24 hours';
  delete from public.group_messages where created_at < now() - interval '24 hours';
  delete from public.comments where created_at < now() - interval '24 hours';
  begin
    delete from public.room_messages where created_at < now() - interval '24 hours';
  exception when undefined_table then
    null;
  end;
end;
$$;

revoke all on function public.delete_24h_enabled() from public;
grant execute on function public.delete_24h_enabled() to authenticated;
revoke all on function public.set_delete_24h_enabled(boolean) from public;
grant execute on function public.set_delete_24h_enabled(boolean) to authenticated;
revoke all on function public.sweep_expired_posts() from public;
grant execute on function public.sweep_expired_posts() to authenticated;
revoke all on function public.sweep_app_24h() from public;
grant execute on function public.sweep_app_24h() to authenticated;
