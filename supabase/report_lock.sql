-- Report risk and posting lock. Run once in the Supabase SQL Editor.
-- Does not delete members, photos, or chats.
-- Three different members must report the same person.
-- That person cannot post until an admin clears the lock.
-- This does not ban the device. Only an admin can ban the account.

alter table public.reports add column if not exists target_user_id uuid;

update public.reports r
set target_user_id = p.user_id
from public.posts p
where r.target_user_id is null
  and r.target_type = 'post'
  and r.target_id::text = p.id::text;

create table if not exists public.member_flags (
  user_id uuid primary key,
  cleared_at timestamptz
);

alter table public.member_flags enable row level security;
revoke all on table public.member_flags from public, anon, authenticated;

create or replace function public.distinct_report_count(uid uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct r.reporter_id)::integer
  from public.reports r
  where r.target_user_id = uid
    and r.reporter_id is distinct from uid
    and coalesce(r.status, 'open') <> 'dismissed'
    and r.created_at > coalesce(
      (select f.cleared_at from public.member_flags f where f.user_id = uid),
      '-infinity'::timestamptz
    );
$$;

create or replace function public.report_risk_counts(uids uuid[])
returns table(user_id uuid, reporters integer)
language sql
stable
security definer
set search_path = public
as $$
  select u, public.distinct_report_count(u)
  from unnest(coalesce(uids, array[]::uuid[])) as u;
$$;

create or replace function public.posting_locked()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    else public.distinct_report_count(auth.uid()) >= 3
  end;
$$;

create or replace function public.admin_clear_post_lock(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_hush_admin() is not true then
    raise exception 'Admin only';
  end if;
  insert into public.member_flags(user_id, cleared_at)
  values (uid, now())
  on conflict (user_id) do update set cleared_at = now();
end;
$$;

create or replace function public.hush_block_reported_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid;
begin
  if tg_table_name in ('messages', 'group_messages') then
    who := new.sender_id;
  else
    who := new.user_id;
  end if;
  if who is not null and public.distinct_report_count(who) >= 3 then
    raise exception 'Posting is paused after 3 member reports. An admin must review this account.';
  end if;
  return new;
end;
$$;

drop trigger if exists hush_posts_report_lock on public.posts;
create trigger hush_posts_report_lock
  before insert on public.posts
  for each row execute function public.hush_block_reported_write();

drop trigger if exists hush_comments_report_lock on public.comments;
create trigger hush_comments_report_lock
  before insert on public.comments
  for each row execute function public.hush_block_reported_write();

drop trigger if exists hush_messages_report_lock on public.messages;
create trigger hush_messages_report_lock
  before insert on public.messages
  for each row execute function public.hush_block_reported_write();

drop trigger if exists hush_group_messages_report_lock on public.group_messages;
create trigger hush_group_messages_report_lock
  before insert on public.group_messages
  for each row execute function public.hush_block_reported_write();

revoke all on function public.distinct_report_count(uuid) from public, anon, authenticated;
revoke all on function public.report_risk_counts(uuid[]) from public;
grant execute on function public.report_risk_counts(uuid[]) to authenticated;
revoke all on function public.posting_locked() from public;
grant execute on function public.posting_locked() to authenticated;
revoke all on function public.admin_clear_post_lock(uuid) from public;
grant execute on function public.admin_clear_post_lock(uuid) to authenticated;
revoke all on function public.hush_block_reported_write() from public, anon, authenticated;
