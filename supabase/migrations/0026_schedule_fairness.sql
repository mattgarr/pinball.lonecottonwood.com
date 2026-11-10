-- Tournament cutoff fairness (Nov 10), on top of 0025.
-- * Logging grace: play ends at tourney_ends_at, but scores logged up to 3 minutes later still count
--   (people finishing their last ball need time to snap the score).
-- * Changing the times re-tags this event's scores by when they were logged (except ones logged after
--   the manual free-play switch, and ones the host set by hand).
-- * The host can add a score that counts after the end, and flip any score between Counts / Free play.
-- * Undo: no undoing a tournament score once the logging window has closed, or during the reveal.
-- * Review queue: "new #1 without a photo" compares against tournament scores only; free play is never flagged.
-- Safe to run more than once.
alter table public.scores add column if not exists kind_set_by_host boolean not null default false;

-- Would a score logged at p_at count as free play by the schedule alone (grace included)?
create or replace function public._outside_window(p_event_id int, p_at timestamptz)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select (e.tourney_starts_at is not null and p_at < e.tourney_starts_at)
      or (e.tourney_ends_at is not null and p_at >= e.tourney_ends_at + interval '3 minutes')
    from public.events e where e.id = p_event_id), false)
$$;
revoke all on function public._outside_window(int, timestamptz) from public, anon, authenticated;

create or replace function public._is_free_play(p_event_id int)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select e.free_play from public.events e where e.id = p_event_id), false)
      or public._outside_window(p_event_id, now())
$$;
revoke all on function public._is_free_play(int) from public, anon, authenticated;

-- Re-tag an event's scores against its current window.
create or replace function public._retag_scores(p_event_id int)
returns void language sql security definer set search_path = public, extensions as $$
  update public.scores s set free_play = public._outside_window(p_event_id, s.created_at)
  from public.events e
  where e.id = p_event_id and s.event_id = p_event_id and not s.kind_set_by_host
    and not (e.free_play_at is not null and s.created_at >= e.free_play_at)
    and s.free_play is distinct from public._outside_window(p_event_id, s.created_at)
$$;
revoke all on function public._retag_scores(int) from public, anon, authenticated;

create or replace function public.host_set_schedule(p_pass text, p_starts timestamptz, p_ends timestamptz)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_ev int := public._current_event();
begin
  perform public._require_host(p_pass);
  if v_ev is null then raise exception 'No active event.'; end if;
  if p_starts is not null and p_ends is not null and p_ends <= p_starts then
    raise exception 'The end time has to be after the start time.';
  end if;
  update public.events set tourney_starts_at = p_starts, tourney_ends_at = p_ends where id = v_ev;
  perform public._retag_scores(v_ev);
  perform public._mirror_party();
end $$;

-- Add a score by hand. p_counts: true = counts for the tournament, false = free play, null = by the clock.
drop function if exists public.host_add_score(text, bigint, int, bigint);
create or replace function public.host_add_score(p_pass text, p_player_id bigint, p_machine_id int, p_value bigint, p_counts boolean default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_ev int := public._current_event();
begin
  perform public._require_host(p_pass);
  perform public._enter_event(p_player_id);
  insert into public.scores (player_id, machine_id, value, event_id, free_play, kind_set_by_host)
  values (p_player_id, p_machine_id, p_value, v_ev,
          case when p_counts is null then public._is_free_play(v_ev) else not p_counts end, p_counts is not null);
end $$;
revoke all on function public.host_add_score(text, bigint, int, bigint, boolean) from public;
grant execute on function public.host_add_score(text, bigint, int, bigint, boolean) to anon, authenticated;

-- Flip one score between counting for the tournament and free play.
create or replace function public.host_set_score_kind(p_pass text, p_score_id bigint, p_counts boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.scores set free_play = not p_counts, kind_set_by_host = true where id = p_score_id;
  if not found then raise exception 'Score not found.'; end if;
end $$;
revoke all on function public.host_set_score_kind(text, bigint, boolean) from public;
grant execute on function public.host_set_score_kind(text, bigint, boolean) to anon, authenticated;

create or replace function public.undo_score(p_token text, p_score_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token); s public.scores%rowtype; e public.events%rowtype;
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  select * into s from public.scores
  where id = p_score_id and (player_id = v_pid or logged_by = v_pid) and created_at > now() - interval '15 minutes';
  if not found then raise exception 'Only your own scores from the last 15 minutes can be undone.'; end if;
  select * into e from public.events where id = s.event_id;
  if not s.free_play and (e.reveal_active
      or (e.tourney_ends_at is not null and now() >= e.tourney_ends_at + interval '3 minutes')) then
    raise exception 'The tournament is over, so its scores are final. Ask a host if something''s wrong.';
  end if;
  update public.scores set voided = true where id = s.id;
  return json_build_object('ok', true);
end $$;

-- Same as 0025, plus the review check compares with tournament scores only, and free play is never flagged.
create or replace function public._insert_score(p_player_id bigint, p_logged_by bigint, p_machine_id int, p_value bigint, p_photo_path text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_top bigint; v_dup_id bigint; v_dup_by bigint; v_ev int := public._current_event(); v_fp boolean;
begin
  if v_ev is null or (select status from public.events where id = v_ev) <> 'open' then
    raise exception 'The event is closed, so scores are locked.';
  end if;
  v_fp := public._is_free_play(v_ev);
  if not exists (select 1 from public.players where id = p_player_id) then raise exception 'Unknown player.'; end if;
  if not exists (select 1 from public.machines m join public.event_machines em on em.machine_id = m.id
                 where m.id = p_machine_id and m.active and em.event_id = v_ev) then
    raise exception 'That machine isn''t part of this event.';
  end if;
  if p_value is null or p_value < 0 or p_value > 99999999999 then raise exception 'That score looks off.'; end if;
  if p_photo_path is not null and p_photo_path !~ '^photos/[0-9a-f-]{36}\.jpg$' then p_photo_path := null; end if;
  -- A photo is proof only for whoever first used it (one photo can cover a group's scores). Someone
  -- else's photo counts as no photo, so the score gets the host's second look like any unproven one.
  if p_photo_path is not null and exists (
    select 1 from public.scores where photo_path = p_photo_path and coalesce(logged_by, player_id) <> p_logged_by
  ) then p_photo_path := null; end if;

  perform pg_advisory_xact_lock(hashtextextended('score:' || p_player_id || ':' || p_machine_id, 0));
  -- A duplicate is the same game only within the same kind.
  select id, coalesce(logged_by, player_id) into v_dup_id, v_dup_by
  from public.scores
  where player_id = p_player_id and machine_id = p_machine_id and value = p_value and not voided
    and event_id = v_ev and free_play = v_fp and created_at > now() - interval '45 minutes'
  order by id limit 1;
  if v_dup_id is not null then
    if p_photo_path is not null then
      update public.scores set photo_path = p_photo_path where id = v_dup_id and photo_path is null;
    end if;
    return json_build_object('score_id', v_dup_id, 'duplicate', true, 'logged_by', v_dup_by, 'free_play', v_fp);
  end if;

  perform public._enter_event(p_player_id);
  select max(value) into v_top from public.scores
  where machine_id = p_machine_id and event_id = v_ev and not voided and not free_play;
  insert into public.scores (player_id, machine_id, value, logged_by, photo_path, needs_review, event_id, free_play)
  values (p_player_id, p_machine_id, p_value, nullif(p_logged_by, p_player_id), p_photo_path,
          not v_fp and ((p_photo_path is null and p_value > coalesce(v_top, -1) and v_top is not null) or (p_logged_by <> p_player_id and p_photo_path is null)),
          v_ev, v_fp)
  returning id into v_id;
  return json_build_object('score_id', v_id, 'duplicate', false, 'logged_by', p_logged_by, 'free_play', v_fp);
end $$;
revoke all on function public._insert_score(bigint, bigint, int, bigint, text) from public, anon, authenticated;
