-- Shared tickets: one sign-up link (or QR) can sign up several people, e.g. a couple on one ticket.
-- The first person attaches to the guest's row as before. Each extra person gets their own guest-list
-- row (no email of its own, parent_id = the original row), and the original row's party size drops by one.
alter table public.event_invites alter column email drop not null;
alter table public.event_invites add column if not exists parent_id bigint references public.event_invites(id) on delete set null;

-- Invite links show who on the ticket has already signed up.
create or replace function public.invite_info(p_invite text)
returns json language sql stable security definer set search_path = public, extensions as $$
  select json_build_object('email', i.email, 'name', i.name, 'event_name', e.name, 'event_date', e.starts_on,
                           'joined', i.player_id is not null,
                           'players', (select coalesce(json_agg(p.display_name order by x.id), '[]'::json)
                                       from public.event_invites x join public.players p on p.id = x.player_id
                                       where x.id = i.id or x.parent_id = i.id))
  from public.event_invites i join public.events e on e.id = i.event_id
  where i.token = coalesce(p_invite, '')
$$;

create or replace function public.claim_invite(p_token text, p_invite text, p_consent boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token); v_inv public.event_invites%rowtype; v_name text;
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  select * into v_inv from public.event_invites where token = coalesce(p_invite, '') for update;
  if not found then return; end if;
  if v_inv.player_id is null or v_inv.player_id = v_pid then
    update public.event_invites set player_id = v_pid where id = v_inv.id;
  elsif not exists (select 1 from public.event_invites where parent_id = v_inv.id and player_id = v_pid) then
    -- Someone else on the same ticket: give them their own row.
    select display_name into v_name from public.players where id = v_pid;
    insert into public.event_invites (event_id, email, name, paid, rsvp, party_size, parent_id, player_id,
                                      invited_at, register_sent_at)
    values (v_inv.event_id, null, left(coalesce(v_name, 'Guest'), 60), v_inv.paid, v_inv.rsvp, 1, v_inv.id, v_pid,
            v_inv.invited_at, v_inv.register_sent_at);
    update public.event_invites set party_size = greatest(1, party_size - 1) where id = v_inv.id;
  end if;
  if v_inv.email is not null and coalesce(p_consent, false) then
    insert into public.player_contacts (player_id, email, consent_at) values (v_pid, v_inv.email, now())
    on conflict (player_id) do update set email = excluded.email, consent_at = now();
  end if;
end $$;

-- Guest list: include which ticket an extra player is on.
create or replace function public.host_invites(p_pass text, p_event_id int)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  return coalesce((
    select json_agg(json_build_object(
      'id', i.id, 'email', i.email, 'name', i.name, 'phone', i.phone, 'party_size', i.party_size,
      'paid', i.paid, 'rsvp', i.rsvp, 'notes', i.notes, 'token', i.token,
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

-- Editing a guest: extra players (on someone else's ticket) don't need an email.
create or replace function public.host_save_guest(p_pass text, p_event_id int, p_id bigint, p_name text, p_email text,
  p_phone text, p_party_size int, p_paid boolean, p_rsvp text, p_notes text)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint := p_id; v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_extra boolean := v_id is not null and exists (select 1 from public.event_invites where id = v_id and parent_id is not null);
begin
  perform public._require_host(p_pass);
  if v_email is null and not v_extra then raise exception 'That email doesn''t look right.'; end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email doesn''t look right.'; end if;
  if p_rsvp is not null and p_rsvp not in ('yes', 'maybe', 'no') then raise exception 'Bad RSVP.'; end if;
  if v_email is not null and exists (select 1 from public.event_invites where event_id = p_event_id and email = v_email and id is distinct from v_id) then
    raise exception 'That email is already on the guest list.';
  end if;
  if v_id is null then
    insert into public.event_invites (event_id, email, name, phone, party_size, paid, rsvp, notes)
    values (p_event_id, v_email, nullif(btrim(coalesce(p_name, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''),
            greatest(1, least(20, coalesce(p_party_size, 1))), coalesce(p_paid, false), p_rsvp, nullif(btrim(coalesce(p_notes, '')), ''))
    returning id into v_id;
  else
    update public.event_invites set
      -- a new email address clears an old bounce
      bounce_at = case when email is distinct from v_email then null else bounce_at end,
      bounce_kind = case when email is distinct from v_email then null else bounce_kind end,
      bounce_note = case when email is distinct from v_email then null else bounce_note end,
      email = v_email, name = nullif(btrim(coalesce(p_name, '')), ''),
      phone = nullif(btrim(coalesce(p_phone, '')), ''), party_size = greatest(1, least(20, coalesce(p_party_size, 1))),
      paid = coalesce(p_paid, false), rsvp = p_rsvp, notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
    where id = v_id and event_id = p_event_id;
    if not found then raise exception 'Guest not found.'; end if;
  end if;
  return v_id;
end $$;
