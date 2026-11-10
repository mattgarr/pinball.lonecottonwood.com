-- Free play + tournament schedule (Nov 10).
-- * A score is either a tournament score or a free-play score (scores.free_play). Free-play scores
--   never count: standings, prizes, the reveal and the results email all skip them.
-- * The database decides at insert time (its own clock), so a phone or TV with a wrong clock can't
--   miscount. A score is free play when the event is in manual free play (after the awards), or it's
--   before the event's tourney_starts_at, or at/after its tourney_ends_at. No times set = as before.
-- * The event's free play flag and schedule are mirrored onto party, like status.
-- Safe to run more than once.
alter table public.events add column if not exists free_play boolean not null default false;
alter table public.events add column if not exists free_play_at timestamptz;
alter table public.events add column if not exists tourney_starts_at timestamptz;
alter table public.events add column if not exists tourney_ends_at timestamptz;
alter table public.party  add column if not exists free_play boolean not null default false;
alter table public.party  add column if not exists free_play_at timestamptz;
alter table public.party  add column if not exists tourney_starts_at timestamptz;
alter table public.party  add column if not exists tourney_ends_at timestamptz;
alter table public.scores add column if not exists free_play boolean not null default false;

-- The TV and phones sync their countdowns to this clock.
create or replace function public.server_now()
returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.server_now() to anon, authenticated;

-- Is a score logged right now in this event free play?
create or replace function public._is_free_play(p_event_id int)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select e.free_play
      or (e.tourney_starts_at is not null and now() < e.tourney_starts_at)
      or (e.tourney_ends_at is not null and now() >= e.tourney_ends_at)
    from public.events e where e.id = p_event_id), false)
$$;
revoke all on function public._is_free_play(int) from public, anon, authenticated;

create or replace function public._mirror_party()
returns void language sql security definer set search_path = public, extensions as $$
  update public.party p set name = e.name, status = e.status, reveal_active = e.reveal_active, match_digits = e.match_digits,
    free_play = e.free_play, free_play_at = e.free_play_at,
    tourney_starts_at = e.tourney_starts_at, tourney_ends_at = e.tourney_ends_at, updated_at = now()
  from public.events e where p.id = 1 and e.id = p.current_event_id
$$;
revoke all on function public._mirror_party() from public, anon, authenticated;

-- After the awards: free play on (ends the reveal, opens logging) or off (closes logging).
create or replace function public.host_free_play(p_pass text, p_on boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_ev int := public._current_event();
begin
  perform public._require_host(p_pass);
  if v_ev is null then raise exception 'No active event.'; end if;
  update public.events set free_play = p_on,
    free_play_at = case when p_on then coalesce(case when free_play then free_play_at end, now()) else free_play_at end,
    status = case when p_on then 'open' else 'closed' end,
    reveal_active = case when p_on then false else reveal_active end
  where id = v_ev;
  perform public._mirror_party();
end $$;
revoke all on function public.host_free_play(text, boolean) from public;
grant execute on function public.host_free_play(text, boolean) to anon, authenticated;

-- Tournament start and end times for the active event (null = not set). Logging stays open outside
-- the window; those scores are free play.
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
  perform public._mirror_party();
end $$;
revoke all on function public.host_set_schedule(text, timestamptz, timestamptz) from public;
grant execute on function public.host_set_schedule(text, timestamptz, timestamptz) to anon, authenticated;

-- Switching events carries that event's free play and schedule too.
create or replace function public.host_set_current_event(p_pass text, p_event_id int)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  if not exists (select 1 from public.events where id = p_event_id) then raise exception 'Event not found.'; end if;
  update public.party set current_event_id = p_event_id where id = 1;
  perform public._mirror_party();
end $$;

-- Host-added scores follow the same rule.
create or replace function public.host_add_score(p_pass text, p_player_id bigint, p_machine_id int, p_value bigint)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_ev int := public._current_event();
begin
  perform public._require_host(p_pass);
  perform public._enter_event(p_player_id);
  insert into public.scores (player_id, machine_id, value, event_id, free_play)
  values (p_player_id, p_machine_id, p_value, v_ev, public._is_free_play(v_ev));
end $$;

-- Same as 0023, plus: the score is marked free play when _is_free_play says so.
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
  -- A duplicate is the same game only within the same kind (a tournament score re-sent after the
  -- end shouldn't merge into free play, and the other way round).
  select id, coalesce(logged_by, player_id) into v_dup_id, v_dup_by
  from public.scores
  where player_id = p_player_id and machine_id = p_machine_id and value = p_value and not voided
    and event_id = v_ev and free_play = v_fp and created_at > now() - interval '45 minutes'
  order by id limit 1;
  if v_dup_id is not null then
    if p_photo_path is not null then
      update public.scores set photo_path = p_photo_path where id = v_dup_id and photo_path is null;
    end if;
    return json_build_object('score_id', v_dup_id, 'duplicate', true, 'logged_by', v_dup_by);
  end if;

  perform public._enter_event(p_player_id);
  select max(value) into v_top from public.scores where machine_id = p_machine_id and event_id = v_ev and not voided;
  insert into public.scores (player_id, machine_id, value, logged_by, photo_path, needs_review, event_id, free_play)
  values (p_player_id, p_machine_id, p_value, nullif(p_logged_by, p_player_id), p_photo_path,
          (p_photo_path is null and p_value > coalesce(v_top, -1) and v_top is not null) or (p_logged_by <> p_player_id and p_photo_path is null),
          v_ev, v_fp)
  returning id into v_id;
  return json_build_object('score_id', v_id, 'duplicate', false, 'logged_by', p_logged_by, 'free_play', v_fp);
end $$;
revoke all on function public._insert_score(bigint, bigint, int, bigint, text) from public, anon, authenticated;
