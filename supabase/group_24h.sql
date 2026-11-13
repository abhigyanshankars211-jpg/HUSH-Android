-- 24-hour group delete is off until an admin turns it on.
-- Run once. Safe to run again.

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
  if public.delete_24h_enabled() is not true then
    return;
  end if;
  if public.is_hush_admin() is not true
     and not exists (select 1 from public.group_members where group_id = gid and user_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;
  delete from public.group_messages
  where group_id = gid
    and created_at < now() - interval '24 hours';
end;
$$;

revoke all on function public.delete_24h_enabled() from public;
grant execute on function public.delete_24h_enabled() to authenticated;
revoke all on function public.set_delete_24h_enabled(boolean) from public;
grant execute on function public.set_delete_24h_enabled(boolean) to authenticated;
revoke all on function public.sweep_group_messages(uuid) from public;
grant execute on function public.sweep_group_messages(uuid) to authenticated;
