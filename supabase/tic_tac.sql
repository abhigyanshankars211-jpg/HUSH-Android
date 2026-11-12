-- Two-player tic-tac-toe. Run once in the Supabase SQL Editor.
-- Does not delete members, photos, or chats.

create table if not exists public.tic_games (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  player_x uuid not null,
  player_o uuid,
  board text not null default '---------',
  turn text not null default 'x',
  status text not null default 'waiting',
  winner text,
  created_at timestamptz not null default now()
);

alter table public.tic_games enable row level security;
revoke all on table public.tic_games from public, anon;
grant select on table public.tic_games to authenticated;

drop policy if exists tic_read on public.tic_games;
create policy tic_read on public.tic_games
  for select to authenticated
  using (auth.uid() = player_x or auth.uid() = player_o);

create or replace function public.create_tic_game()
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
  loop
    n := n + 1;
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
    begin
      insert into public.tic_games(code, player_x)
      values (c, auth.uid())
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

create or replace function public.join_tic_game(game_code text)
returns public.tic_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.tic_games;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select * into g
  from public.tic_games
  where code = upper(trim(game_code))
  for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if g.player_x = auth.uid() or g.player_o = auth.uid() then
    return g;
  end if;
  if g.status <> 'waiting' or g.player_o is not null then
    raise exception 'This game is already full';
  end if;
  update public.tic_games
  set player_o = auth.uid(), status = 'playing'
  where id = g.id
  returning * into g;
  return g;
end;
$$;

create or replace function public.play_tic(game_code text, cell integer)
returns public.tic_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.tic_games;
  mark text;
  line text;
  lines text[] := array['123','456','789','147','258','369','159','357'];
  won boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if cell < 1 or cell > 9 then
    raise exception 'Choose a square';
  end if;
  select * into g
  from public.tic_games
  where code = upper(trim(game_code))
  for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if g.status <> 'playing' then
    raise exception 'Wait for the other player';
  end if;
  if g.turn = 'x' and g.player_x is distinct from auth.uid() then
    raise exception 'Wait for your turn';
  end if;
  if g.turn = 'o' and g.player_o is distinct from auth.uid() then
    raise exception 'Wait for your turn';
  end if;
  if substr(g.board, cell, 1) <> '-' then
    raise exception 'That square is taken';
  end if;
  mark := g.turn;
  g.board := overlay(g.board placing mark from cell for 1);
  foreach line in array lines loop
    if substr(g.board, substr(line, 1, 1)::int, 1) = mark
       and substr(g.board, substr(line, 2, 1)::int, 1) = mark
       and substr(g.board, substr(line, 3, 1)::int, 1) = mark then
      won := true;
    end if;
  end loop;
  if won then
    g.status := 'done';
    g.winner := mark;
  elsif position('-' in g.board) = 0 then
    g.status := 'done';
    g.winner := 'draw';
  else
    g.turn := case when mark = 'x' then 'o' else 'x' end;
  end if;
  update public.tic_games
  set board = g.board, turn = g.turn, status = g.status, winner = g.winner
  where id = g.id
  returning * into g;
  return g;
end;
$$;

revoke all on function public.create_tic_game() from public;
grant execute on function public.create_tic_game() to authenticated;
revoke all on function public.join_tic_game(text) from public;
grant execute on function public.join_tic_game(text) to authenticated;
revoke all on function public.play_tic(text, integer) from public;
grant execute on function public.play_tic(text, integer) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tic_games'
  ) then
    alter publication supabase_realtime add table public.tic_games;
  end if;
end $$;
