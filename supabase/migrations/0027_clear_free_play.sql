-- Free play / schedule follow-ups (Nov 10). Safe to run more than once.
-- * revealed_at: when the reveal last started. Results stay sealed on the TV / phones from 15 min
--   before the end until a reveal that started after that (an old test reveal doesn't unseal them).
-- * "Clear test scores" also turns free play off and forgets the reveal (the schedule stays).
alter table public.events add column if not exists revealed_at timestamptz;
alter table public.party  add column if not exists revealed_at timestamptz;

create or replace function public._mirror_party()
returns void language sql security definer set search_path = public, extensions as $$
  update public.party p set name = e.name, status = e.status, reveal_active = e.reveal_active, match_digits = e.match_digits,
    free_play = e.free_play, free_play_at = e.free_play_at, revealed_at = e.revealed_at,
    tourney_starts_at = e.tourney_starts_at, tourney_ends_at = e.tourney_ends_at, updated_at = now()
  from public.events e where p.id = 1 and e.id = p.current_event_id
$$;
revoke all on function public._mirror_party() from public, anon, authenticated;

create or replace function public.host_reveal(p_pass text, p_active boolean, p_match_digits int default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.events set reveal_active = p_active,
    match_digits = case when p_active then p_match_digits else match_digits end,
    revealed_at = case when p_active then now() else revealed_at end
  where id = public._current_event();
  update public.party set reveal_step = case when p_active then 0 else reveal_step end where id = 1;
  perform public._mirror_party();
end $$;

create or replace function public.host_clear_scores(p_pass text, p_confirm text)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_n int; v_ev int := public._current_event();
begin
  perform public._require_host(p_pass);
  if p_confirm <> 'CLEAR' then raise exception 'Type CLEAR to confirm.'; end if;
  select count(*) into v_n from public.scores where event_id = v_ev;
  delete from public.scores where event_id = v_ev;
  update public.events set reveal_active = false, match_digits = null, results_sent_at = null,
    free_play = false, free_play_at = null, revealed_at = null where id = v_ev;
  perform public._mirror_party();
  return v_n;
end $$;
