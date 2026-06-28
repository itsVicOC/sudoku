create or replace function public.submit_score(
  player_id_input text,
  difficulty_input text,
  puzzle_key_input text,
  time_ms_input integer
)
returns table (
  player_id text,
  difficulty text,
  puzzle_key text,
  time_ms integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_player_id text := trim(player_id_input);
begin
  if char_length(clean_player_id) < 1 or char_length(clean_player_id) > 16 then
    raise exception 'player_id must be 1-16 characters';
  end if;

  if difficulty_input not in ('easy', 'casual', 'expert', 'master') then
    raise exception 'invalid difficulty';
  end if;

  if puzzle_key_input !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}:(easy|casual|expert|master)$' then
    raise exception 'invalid puzzle_key';
  end if;

  if puzzle_key_input <> (substring(puzzle_key_input from 1 for 10) || ':' || difficulty_input) then
    raise exception 'puzzle_key difficulty mismatch';
  end if;

  if time_ms_input < 1000 or time_ms_input > 86400000 then
    raise exception 'invalid time_ms';
  end if;

  insert into public.leaderboard_scores (player_id, difficulty, puzzle_key, time_ms)
  values (clean_player_id, difficulty_input, puzzle_key_input, time_ms_input)
  on conflict on constraint leaderboard_unique_player_per_puzzle
  do update set
    player_id = excluded.player_id,
    time_ms = excluded.time_ms,
    achieved_at = now()
  where excluded.time_ms < public.leaderboard_scores.time_ms;

  return query
  select s.player_id, s.difficulty, s.puzzle_key, s.time_ms, s.achieved_at as created_at
  from public.leaderboard_scores s
  where s.difficulty = difficulty_input
    and s.puzzle_key = puzzle_key_input
    and s.player_id_key = lower(clean_player_id);
end;
$$;

create or replace function public.get_leaderboard(
  difficulty_input text,
  puzzle_key_input text
)
returns table (
  rank bigint,
  player_id text,
  time_ms integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    row_number() over (order by s.time_ms asc, s.achieved_at asc) as rank,
    s.player_id,
    s.time_ms,
    s.achieved_at as created_at
  from public.leaderboard_scores s
  where s.difficulty = difficulty_input
    and s.puzzle_key = puzzle_key_input
  order by s.time_ms asc, s.achieved_at asc
  limit 10;
$$;

grant execute on function public.submit_score(text, text, text, integer) to anon;
grant execute on function public.get_leaderboard(text, text) to anon;
