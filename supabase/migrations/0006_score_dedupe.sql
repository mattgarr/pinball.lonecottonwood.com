-- Score dedupe: one game, logged by two phones, counts once.
--
-- Tina scans a 4-player game and logs everyone. Three minutes later Tom scans the same
-- display and logs his own score. Same player + machine + exact value within 45 minutes is
-- the same game, so the second submission returns the existing row instead of inserting.
-- Covers every direction: friend-then-self, self-then-friend, friend-then-friend.
--
-- The returned json gains `logged_by`: who logged the existing row (the player themself when
-- they self-logged; scores.logged_by is null in that case, so we coalesce to player_id).
--
-- A per-player+machine advisory lock makes two phones submitting the same second safe:
-- the second waits for the first to commit, then sees its row.
--
-- host_add_score is untouched on purpose: the host is the manual override.
-- Safe to run more than once.

create or replace function public._insert_score(p_player_id bigint, p_logged_by bigint, p_machine_id int, p_value bigint, p_photo_path text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_top bigint; v_dup_id bigint; v_dup_by bigint;
begin
  if (select status from public.party where id = 1) <> 'open' then
    raise exception 'The party is closed, so scores are locked.';
  end if;
  if not exists (select 1 from public.players where id = p_player_id) then raise exception 'Unknown player.'; end if;
  if not exists (select 1 from public.machines where id = p_machine_id and active) then raise exception 'Unknown machine.'; end if;
  if p_value is null or p_value < 0 or p_value > 99999999999 then raise exception 'That score looks off.'; end if;
  if p_photo_path is not null and p_photo_path !~ '^photos/[0-9a-f-]{36}\.jpg$' then p_photo_path := null; end if;

  -- Serialize submissions for this player on this machine (released at commit).
  perform pg_advisory_xact_lock(hashtextextended('score:' || p_player_id || ':' || p_machine_id, 0));

  select id, coalesce(logged_by, player_id) into v_dup_id, v_dup_by
  from public.scores
  where player_id = p_player_id and machine_id = p_machine_id and value = p_value and not voided
    and created_at > now() - interval '45 minutes'
  order by id
  limit 1;
  if v_dup_id is not null then
    -- Late photo proof from the second phone? Keep it on the existing row.
    if p_photo_path is not null then
      update public.scores set photo_path = p_photo_path where id = v_dup_id and photo_path is null;
    end if;
    return json_build_object('score_id', v_dup_id, 'duplicate', true, 'logged_by', v_dup_by);
  end if;

  select max(value) into v_top from public.scores where machine_id = p_machine_id and not voided;
  insert into public.scores (player_id, machine_id, value, logged_by, photo_path, needs_review)
  values (p_player_id, p_machine_id, p_value, nullif(p_logged_by, p_player_id), p_photo_path,
          -- a new #1 with no photo, or logged for someone else, gets a second look from the host
          (p_photo_path is null and p_value > coalesce(v_top, -1) and v_top is not null) or (p_logged_by <> p_player_id and p_photo_path is null))
  returning id into v_id;
  return json_build_object('score_id', v_id, 'duplicate', false, 'logged_by', p_logged_by);
end $$;
revoke all on function public._insert_score(bigint, bigint, int, bigint, text) from public, anon, authenticated;

-- The dedupe lookup: player + machine, newest first.
create index if not exists scores_player_machine on public.scores (player_id, machine_id, created_at desc);
