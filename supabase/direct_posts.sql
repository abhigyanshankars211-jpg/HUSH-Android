-- Wall photos go live without admin approval.
-- Run once. Admin can still delete a photo later.

update public.posts
set approved = true
where approved is distinct from true;

create or replace function public.publish_wall_photo(photo_path text, photo_caption text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if public.is_hush_banned() is true then
    raise exception 'Account restricted';
  end if;
  if photo_path is null or photo_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'Bad photo';
  end if;
  insert into public.posts(user_id, image_path, caption, approved)
  values (auth.uid(), photo_path, left(coalesce(photo_caption, ''), 240), true)
  returning id into pid;
  return pid;
end;
$$;

revoke all on function public.publish_wall_photo(text, text) from public;
grant execute on function public.publish_wall_photo(text, text) to authenticated;
