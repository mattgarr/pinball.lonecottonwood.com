-- Scores: a photo can't be borrowed (Nov 10). Before this, anyone could attach another guest's
-- (publicly listed) score photo to their own score, which skipped the host review flag. Now a photo
-- path counts only for the person who first used it. Same function as 0007 otherwise.
-- Safe to run more than once.
create or replace function public._insert_score(p_player_id bigint, p_logged_by bigint, p_machine_id int, p_value bigint, p_photo_path text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_top bigint; v_dup_id bigint; v_dup_by bigint; v_ev int := public._current_event();
begin
  if v_ev is null or (select status from public.events where id = v_ev) <> 'open' then
    raise exception 'The event is closed, so scores are locked.';
  end if;
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
  select id, coalesce(logged_by, player_id) into v_dup_id, v_dup_by
  from public.scores
  where player_id = p_player_id and machine_id = p_machine_id and value = p_value and not voided
    and event_id = v_ev and created_at > now() - interval '45 minutes'
  order by id limit 1;
  if v_dup_id is not null then
    if p_photo_path is not null then
      update public.scores set photo_path = p_photo_path where id = v_dup_id and photo_path is null;
    end if;
    return json_build_object('score_id', v_dup_id, 'duplicate', true, 'logged_by', v_dup_by);
  end if;

  perform public._enter_event(p_player_id);
  select max(value) into v_top from public.scores where machine_id = p_machine_id and event_id = v_ev and not voided;
  insert into public.scores (player_id, machine_id, value, logged_by, photo_path, needs_review, event_id)
  values (p_player_id, p_machine_id, p_value, nullif(p_logged_by, p_player_id), p_photo_path,
          (p_photo_path is null and p_value > coalesce(v_top, -1) and v_top is not null) or (p_logged_by <> p_player_id and p_photo_path is null),
          v_ev)
  returning id into v_id;
  return json_build_object('score_id', v_id, 'duplicate', false, 'logged_by', p_logged_by);
end $$;
revoke all on function public._insert_score(bigint, bigint, int, bigint, text) from public, anon, authenticated;
