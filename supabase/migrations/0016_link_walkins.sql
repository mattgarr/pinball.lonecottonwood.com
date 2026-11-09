-- Walk-ins link themselves or get linked in one tap (Nov 8). Safe to run more than once.
-- * link_by_email: a player who joined WITHOUT a ticket link but typed an email that's on the guest list
--   gets linked to that guest row automatically (only if the row isn't taken and they're not on a row yet).
-- * host_link_player: the Guest manager's "Add to a ticket" menu for people in "Joined at the party".
--   If the ticket's row is free they take it; otherwise they're added under it (like a shared-ticket sign-up).

create or replace function public.link_by_email(p_token text, p_email text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_ev int := public._current_event();
  v_id bigint;
begin
  if v_pid is null or v_email is null or v_ev is null then return 'skipped'; end if;
  if exists (select 1 from public.event_invites where event_id = v_ev and player_id = v_pid) then return 'already'; end if;
  select id into v_id from public.event_invites
  where event_id = v_ev and email = v_email and player_id is null
  order by id limit 1 for update;
  if v_id is null then return 'none'; end if;
  update public.event_invites set player_id = v_pid, updated_at = now() where id = v_id;
  return 'linked';
end $$;

create or replace function public.host_link_player(p_pass text, p_event_id int, p_player_id bigint, p_invite_id bigint)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_inv public.event_invites%rowtype; v_name text;
begin
  perform public._require_host(p_pass);
  select display_name into v_name from public.players where id = p_player_id;
  if v_name is null then raise exception 'Player not found.'; end if;
  if exists (select 1 from public.event_invites where event_id = p_event_id and player_id = p_player_id) then
    raise exception '% is already on a ticket.', v_name;
  end if;
  select * into v_inv from public.event_invites where id = p_invite_id and event_id = p_event_id for update;
  if not found then raise exception 'Guest not found.'; end if;
  if v_inv.parent_id is not null then  -- picked someone on a shared ticket: use the ticket itself
    select * into v_inv from public.event_invites where id = v_inv.parent_id for update;
  end if;
  if v_inv.player_id is null then
    update public.event_invites set player_id = p_player_id, updated_at = now() where id = v_inv.id;
    return 'linked';
  end if;
  insert into public.event_invites (event_id, email, name, paid, rsvp, party_size, parent_id, player_id, invited_at, register_sent_at)
  values (v_inv.event_id, null, left(v_name, 60), v_inv.paid, v_inv.rsvp, 1, v_inv.id, p_player_id, v_inv.invited_at, v_inv.register_sent_at);
  return 'added';
end $$;

grant execute on function public.link_by_email(text, text), public.host_link_player(text, int, bigint, bigint)
  to anon, authenticated;

-- Couples: a ticket named "Chris and Cina Boitnott" asks "Which one are you?". The answer (full name, e.g.
-- "Cina Boitnott") is saved on the player's guest row as `who`, so the app knows who's still to sign up
-- and the Guest manager shows real names.
alter table public.event_invites add column if not exists who text check (who is null or length(who) <= 60);

-- p_ticket_name: when a guest fixes the spelling of their name ("Cina" -> "Gina"), the app sends the
-- corrected ticket name ("Chris and Gina Boitnott") so the guest list is fixed too.
drop function if exists public.set_ticket_who(text, text);
create or replace function public.set_ticket_who(p_token text, p_who text, p_ticket_name text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token);
  v_who text := nullif(left(btrim(coalesce(p_who, '')), 60), '');
  v_ticket text := nullif(left(btrim(coalesce(p_ticket_name, '')), 60), '');
  v_id bigint; v_root bigint; v_kid boolean;
begin
  if v_pid is null or v_who is null then return 'skipped'; end if;
  select id, coalesce(parent_id, id), parent_id is not null into v_id, v_root, v_kid from public.event_invites
  where player_id = v_pid and event_id = public._current_event() order by id limit 1 for update;
  if v_id is null then return 'skipped'; end if;
  -- An extra person's row is named after them; the ticket's own row keeps the ticket's name.
  update public.event_invites set who = v_who, name = case when v_kid then v_who else name end, updated_at = now() where id = v_id;
  if v_ticket is not null then
    update public.event_invites set name = v_ticket, updated_at = now() where id = v_root and name is distinct from v_ticket;
  end if;
  return 'saved';
end $$;

create or replace function public.invite_info(p_invite text)
returns json language sql stable security definer set search_path = public, extensions as $$
  select json_build_object('email', i.email, 'name', r.name, 'event_name', e.name, 'event_date', e.starts_on,
                           'joined', i.player_id is not null,
                           'players', (select coalesce(json_agg(p.display_name order by x.id), '[]'::json)
                                       from public.event_invites x join public.players p on p.id = x.player_id
                                       where x.id = r.id or x.parent_id = r.id),
                           'player_ids', (select coalesce(json_agg(p.id order by x.id), '[]'::json)
                                          from public.event_invites x join public.players p on p.id = x.player_id
                                          where x.id = r.id or x.parent_id = r.id),
                           'player_whos', (select coalesce(json_agg(x.who order by x.id), '[]'::json)
                                           from public.event_invites x join public.players p on p.id = x.player_id
                                           where x.id = r.id or x.parent_id = r.id),
                           'taken', (select coalesce(json_agg(x.who order by x.id), '[]'::json)
                                     from public.event_invites x
                                     where (x.id = r.id or x.parent_id = r.id) and x.player_id is not null and x.who is not null))
  from public.event_invites i
  join public.event_invites r on r.id = coalesce(i.parent_id, i.id)
  join public.events e on e.id = i.event_id
  where i.token = coalesce(p_invite, '')
$$;

-- Guest list: include `who` (which person on a couple's ticket each player is).
create or replace function public.host_invites(p_pass text, p_event_id int)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  return coalesce((
    select json_agg(json_build_object(
      'id', i.id, 'email', i.email, 'name', i.name, 'phone', i.phone, 'party_size', i.party_size,
      'paid', i.paid, 'rsvp', i.rsvp, 'notes', i.notes, 'token', i.token, 'who', i.who,
      'invited_at', i.invited_at, 'register_sent_at', i.register_sent_at, 'update_sent_at', i.update_sent_at,
      'bounce_at', i.bounce_at, 'bounce_kind', i.bounce_kind, 'bounce_note', i.bounce_note,
      'parent_id', i.parent_id, 'parent_name', (select coalesce(pa.name, pa.email) from public.event_invites pa where pa.id = i.parent_id),
      'created_at', i.created_at,
      'player_id', i.player_id, 'player_name', p.display_name, 'player_avatar', p.avatar, 'player_emoji', p.emoji,
      'games', (select count(*) from public.scores s where s.player_id = i.player_id and s.event_id = i.event_id and not s.voided)
    ) order by lower(coalesce(i.name, i.email)))
    from public.event_invites i left join public.players p on p.id = i.player_id
    where i.event_id = p_event_id), '[]'::json);
end $$;

grant execute on function public.set_ticket_who(text, text, text) to anon, authenticated;
