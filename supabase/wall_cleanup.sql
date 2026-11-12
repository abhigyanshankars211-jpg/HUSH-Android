-- HUSH photo and group cleanup. Run once in the Supabase SQL Editor.
-- Additive only. Does not wipe members, chats, or posts by itself.
-- After this, any signed-in app can sweep photos older than 1 hour.
-- Delete buttons stay admin-only.

create table if not exists public.post_delete_marks (
  post_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.post_delete_marks enable row level security;
revoke all on table public.post_delete_marks from public, anon, authenticated;

create or replace function public.hush_purge_post(pid uuid)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  pth text;
begin
  select image_path into pth from public.posts where id = pid;
  if pth is null and not exists (select 1 from public.posts where id = pid) then
    return;
  end if;
  delete from public.comments where post_id = pid;
  delete from public.post_likes where post_id = pid;
  delete from public.post_delete_marks where post_id = pid;
  begin
    delete from public.reports where target_type = 'post' and target_id::text = pid::text;
  exception when others then
    null;
  end;
  delete from public.posts where id = pid;
  if pth is not null then
    begin
      delete from storage.objects where bucket_id = 'pic-wall' and name = pth;
    exception when others then
      null;
    end;
  end if;
end;
$$;

create or replace function public.admin_delete_post(pid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_hush_admin() is not true then
    raise exception 'Admin only';
  end if;
  perform public.hush_purge_post(pid);
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
  for r in
    select id from public.posts
    where created_at < now() - interval '1 hour'
  loop
    perform public.hush_purge_post(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.mark_post_for_delete(pid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if public.is_hush_banned() is true then
    raise exception 'Account restricted';
  end if;
  if not exists (select 1 from public.posts where id = pid) then
    raise exception 'Photo not found';
  end if;
  insert into public.post_delete_marks(post_id, user_id)
  values (pid, auth.uid())
  on conflict do nothing;
end;
$$;

create or replace function public.list_posts_for_admin()
returns table (
  id uuid,
  image_path text,
  caption text,
  username text,
  approved boolean,
  created_at timestamptz,
  marks bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_hush_admin() is not true then
    raise exception 'Admin only';
  end if;
  return query
    select p.id, p.image_path, p.caption, pr.username, p.approved, p.created_at,
           (select count(*) from public.post_delete_marks m where m.post_id = p.id)
    from public.posts p
    left join public.profiles pr on pr.id = p.user_id
    order by (select count(*) from public.post_delete_marks m where m.post_id = p.id) desc,
             p.created_at desc
    limit 80;
end;
$$;

create or replace function public.admin_delete_group(gid uuid)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if public.is_hush_admin() is not true then
    raise exception 'Admin only';
  end if;
  if not exists (select 1 from public.groups where id = gid) then
    raise exception 'Group not found';
  end if;
  begin
    delete from storage.objects
    where bucket_id = 'chat-media'
      and name like 'group/' || gid::text || '/%';
  exception when others then
    null;
  end;
  delete from public.group_messages where group_id = gid;
  delete from public.group_members where group_id = gid;
  delete from public.groups where id = gid;
end;
$$;

revoke all on function public.hush_purge_post(uuid) from public, anon, authenticated;
revoke all on function public.admin_delete_post(uuid) from public;
grant execute on function public.admin_delete_post(uuid) to authenticated;
revoke all on function public.sweep_expired_posts() from public;
grant execute on function public.sweep_expired_posts() to authenticated;
revoke all on function public.mark_post_for_delete(uuid) from public;
grant execute on function public.mark_post_for_delete(uuid) to authenticated;
revoke all on function public.list_posts_for_admin() from public;
grant execute on function public.list_posts_for_admin() to authenticated;
revoke all on function public.admin_delete_group(uuid) from public;
grant execute on function public.admin_delete_group(uuid) to authenticated;
