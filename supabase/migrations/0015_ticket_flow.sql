-- Shared-ticket flow polish (Nov 8). Safe to run more than once: it only replaces functions.
-- * my_ticket: the ME tab's "Bringing someone?" box finds the player's ticket link.
-- * invite_info: shows the whole ticket (also when opened from a partner's own link) plus player ids,
--   so the app recognizes "you" by id instead of nickname.
-- * claim_invite: no longer lowers the ticket's party size (we don't track attendance), treats a
--   partner's own link like the original ticket, and never gives one player two rows in an event.
-- * set_ticket_email: a partner's email (typed at sign-up) goes onto their guest row, so hosts see it
--   and reminder emails reach them.
-- * host_walkins: players who joined without a ticket link (e.g. a machine QR), for the guest manager.

-- ME tab: the sign-up link of the ticket this player joined with (the original ticket for a partner).
create or replace function public.my_ticket(p_token text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select coalesce(pa.token, i.token)
  from public.event_invites i
  left join public.event_invites pa on pa.id = i.parent_id
  where i.player_id = public._player_for_token(p_token)
    and i.event_id = public._current_event()
  order by i.id
  limit 1
$$;

create or replace function public.invite_info(p_invite text)
returns json language sql stable security definer set search_path = public, extensions as $$
  select json_build_object('email', i.email, 'name', i.name, 'event_name', e.name, 'event_date', e.starts_on,
                           'joined', i.player_id is not null,
                           'players', (select coalesce(json_agg(p.display_name order by x.id), '[]'::json)
                                       from public.event_invites x join public.players p on p.id = x.player_id
                                       where x.id = r.id or x.parent_id = r.id),
                           'player_ids', (select coalesce(json_agg(p.id order by x.id), '[]'::json)
                                          from public.event_invites x join public.players p on p.id = x.player_id
                                          where x.id = r.id or x.parent_id = r.id))
  from public.event_invites i
  join public.event_invites r on r.id = coalesce(i.parent_id, i.id)
  join public.events e on e.id = i.event_id
  where i.token = coalesce(p_invite, '')
$$;

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
  if v_inv.email is not null and coalesce(p_consent, false) then
    insert into public.player_contacts (player_id, email, consent_at) values (v_pid, v_inv.email, now())
    on conflict (player_id) do update set email = excluded.email, consent_at = now();
  end if;
end $$;

-- A partner's own email onto their guest row. Returns 'saved', 'taken' (already used by another
-- guest row in this event, left alone) or 'skipped' (not a partner row / bad email).
create or replace function public.set_ticket_email(p_token text, p_email text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_id bigint;
begin
  if v_pid is null or v_email is null or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'skipped'; end if;
  select id into v_id from public.event_invites
  where player_id = v_pid and event_id = public._current_event() and parent_id is not null
  order by id limit 1 for update;
  if v_id is null then return 'skipped'; end if;
  if exists (select 1 from public.event_invites e2 join public.event_invites me on me.id = v_id
             where e2.event_id = me.event_id and e2.email = v_email and e2.id <> v_id) then
    return 'taken';
  end if;
  update public.event_invites set email = v_email, updated_at = now() where id = v_id;
  return 'saved';
end $$;

-- Guest manager: players in this event who aren't on any guest row (joined without a ticket link).
create or replace function public.host_walkins(p_pass text, p_event_id int)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  return coalesce((
    select json_agg(json_build_object(
      'id', p.id, 'name', p.display_name, 'avatar', p.avatar, 'emoji', p.emoji, 'joined_at', en.joined_at,
      'games', (select count(*) from public.scores s where s.player_id = p.id and s.event_id = p_event_id and not s.voided)
    ) order by en.joined_at)
    from public.event_entries en join public.players p on p.id = en.player_id
    where en.event_id = p_event_id
      and not exists (select 1 from public.event_invites i where i.event_id = p_event_id and i.player_id = p.id)), '[]'::json);
end $$;

grant execute on function public.my_ticket(text), public.set_ticket_email(text, text), public.host_walkins(text, int)
  to anon, authenticated;
