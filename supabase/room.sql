-- One public room for every member.
-- Run once. Private chats and groups stay as they are.

create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null,
  body text,
  image_path text,
  created_at timestamptz not null default now()
);

alter table public.room_messages enable row level security;
revoke all on table public.room_messages from public, anon;
grant select, insert on table public.room_messages to authenticated;

drop policy if exists room_read on public.room_messages;
create policy room_read on public.room_messages
  for select to authenticated
  using (true);

drop policy if exists room_write on public.room_messages;
create policy room_write on public.room_messages
  for insert to authenticated
  with check (sender_id = auth.uid());

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
      union
      select image_path from public.room_messages
      where created_at < now() - interval '5 minutes' and image_path is not null
    ) old
    where o.bucket_id = 'chat-media' and o.name = old.name;
  exception when others then
    null;
  end;
  delete from public.messages where created_at < now() - interval '5 minutes';
  delete from public.group_messages where created_at < now() - interval '5 minutes';
  delete from public.comments where created_at < now() - interval '5 minutes';
  delete from public.room_messages where created_at < now() - interval '5 minutes';
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
  if tg_table_name in ('messages', 'group_messages', 'room_messages') then
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

drop trigger if exists hush_room_report_lock on public.room_messages;
create trigger hush_room_report_lock
  before insert on public.room_messages
  for each row execute function public.hush_block_reported_write();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_messages'
  ) then
    alter publication supabase_realtime add table public.room_messages;
  end if;
end $$;
