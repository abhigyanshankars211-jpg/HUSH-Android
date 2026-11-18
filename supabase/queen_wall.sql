-- HUSH: Queen of Whore featured wall (additive migration)
-- Creates one featured-photo pointer. Does not delete or modify existing posts/likes.
-- Run this file once in Supabase SQL Editor before enabling the updated app.

create table if not exists public.queen_wall_featured (
  singleton boolean primary key default true check (singleton is true),
  post_id uuid not null references public.posts(id) on delete cascade,
  featured_at timestamptz not null default now()
);

alter table public.queen_wall_featured enable row level security;
revoke all on table public.queen_wall_featured from public, anon, authenticated;

create or replace function public.hush_set_queen_wall_on_five_likes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total_likes integer;
  is_approved boolean;
begin
  -- Serialize threshold checks so two simultaneous likes cannot race.
  perform pg_advisory_xact_lock(hashtext('hush_queen_wall_featured'));
  select approved into is_approved
  from public.posts where id = new.post_id;

  if coalesce(is_approved, false) is not true then
    return new;
  end if;

  select count(distinct user_id)::integer into total_likes
  from public.post_likes where post_id = new.post_id;

  if total_likes >= 5 then
    insert into public.queen_wall_featured(singleton, post_id, featured_at)
    values (true, new.post_id, now())
    on conflict (singleton) do update
      set post_id = excluded.post_id, featured_at = excluded.featured_at;
  end if;

  return new;
end;
$$;

drop trigger if exists hush_queen_wall_five_likes on public.post_likes;
create trigger hush_queen_wall_five_likes
after insert on public.post_likes
for each row execute function public.hush_set_queen_wall_on_five_likes();

create or replace function public.get_queen_wall_featured()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'post_id', p.id,
    'image_path', p.image_path,
    'caption', p.caption,
    'user_id', p.user_id,
    'created_at', p.created_at,
    'username', pr.username,
    'like_count', (
      select count(distinct l.user_id)
      from public.post_likes l
      where l.post_id = p.id
    )
  )
  from public.queen_wall_featured f
  join public.posts p on p.id = f.post_id
  left join public.profiles pr on pr.id = p.user_id
  where f.singleton is true and p.approved is true
  limit 1;
$$;

revoke all on function public.get_queen_wall_featured() from public;
grant execute on function public.get_queen_wall_featured() to authenticated;
revoke all on function public.hush_set_queen_wall_on_five_likes() from public, anon, authenticated;
