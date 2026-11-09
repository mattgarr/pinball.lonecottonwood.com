-- Multi-event participation & safe per-event score clearing (Nov 8). Safe to run more than once.
-- * enter_event: lets a signed-in player enter a specific tournament (or the active one).
-- * claim_invite: also enters the player into that ticket's event_id (even if it isn't the active event yet).
-- * host_set_entry: lets the host add or remove a permanent player from a specific event's participant list.
-- * host_clear_scores: only clears scores for the CURRENT active event, never past tournaments.

create or replace function public.enter_event(p_token text, p_event_id int default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pid bigint := public._player_for_token(p_token);
  v_ev  int := coalesce(p_event_id, public._current_event());
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  if v_ev is null or not exists (select 1 from public.events where id = v_ev) then
    raise exception 'Event not found.';
  end if;
  insert into public.event_entries (event_id, player_id) values (v_ev, v_pid) on conflict do nothing;
end $$;

create or replace function public.claim_invite(p_token text, p_invite text, p_consent boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token); v_inv public.event_invites%rowtype; v_name text;
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  select * into v_inv from public.event_invites where token = coalesce(p_invite, '') for update;
  if not found then return; end if;
  -- A partner's own link (e.g. from a reminder email) works like the original ticket's link.
  if v_inv.parent_id is not null and v_inv.player_id is not null and v_inv.player_id <> v_pid then
    select * into v_inv from public.event_invites where id = v_inv.parent_id for update;
    if not found then return; end if;
  end if;
  if v_inv.player_id is null or v_inv.player_id = v_pid then
    update public.event_invites set player_id = v_pid where id = v_inv.id;
  elsif not exists (select 1 from public.event_invites where event_id = v_inv.event_id and player_id = v_pid) then
    -- Someone else on the same ticket: give them their own row under it.
    select display_name into v_name from public.players where id = v_pid;
    insert into public.event_invites (event_id, email, name, paid, rsvp, party_size, parent_id, player_id,
                                      invited_at, register_sent_at)
    values (v_inv.event_id, null, left(coalesce(v_name, 'Guest'), 60), v_inv.paid, v_inv.rsvp, 1, v_inv.id, v_pid,
            v_inv.invited_at, v_inv.register_sent_at);
  end if;
  -- Always enter the player into the ticket's event too.
  insert into public.event_entries (event_id, player_id) values (v_inv.event_id, v_pid) on conflict do nothing;
  if v_inv.email is not null and coalesce(p_consent, false) then
    insert into public.player_contacts (player_id, email, consent_at) values (v_pid, v_inv.email, now())
    on conflict (player_id) do update set email = excluded.email, consent_at = now();
  end if;
end $$;

create or replace function public.host_set_entry(p_pass text, p_event_id int, p_player_id bigint, p_in boolean default true)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  if p_in then
    insert into public.event_entries (event_id, player_id) values (p_event_id, p_player_id) on conflict do nothing;
  else
    delete from public.event_entries where event_id = p_event_id and player_id = p_player_id;
  end if;
end $$;

create or replace function public.host_clear_scores(p_pass text, p_confirm text)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_n int; v_ev int := public._current_event();
begin
  perform public._require_host(p_pass);
  if p_confirm <> 'CLEAR' then raise exception 'Type CLEAR to confirm.'; end if;
  select count(*) into v_n from public.scores where event_id = v_ev;
  delete from public.scores where event_id = v_ev;
  update public.events set reveal_active = false, match_digits = null, results_sent_at = null where id = v_ev;
  update public.party set reveal_active = false, match_digits = null, updated_at = now() where id = 1;
  return v_n;
end $$;

grant execute on function
  public.enter_event(text, int),
  public.host_set_entry(text, int, bigint, boolean),
  public.host_clear_scores(text, text)
to anon, authenticated;
