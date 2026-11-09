-- Guest management: contact details, party size, RSVP and notes on each invite, plus host RPCs to
-- edit a guest and read the full list (with their player's games played). Host-only; nothing public.
-- Safe to run more than once.

alter table public.event_invites add column if not exists phone text check (phone is null or length(phone) <= 40);
alter table public.event_invites add column if not exists party_size int not null default 1 check (party_size between 1 and 20);
alter table public.event_invites add column if not exists rsvp text check (rsvp in ('yes', 'maybe', 'no'));
alter table public.event_invites add column if not exists notes text check (notes is null or length(notes) <= 500);
alter table public.event_invites add column if not exists updated_at timestamptz not null default now();

create or replace function public.host_invites(p_pass text, p_event_id int)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  return coalesce((
    select json_agg(json_build_object(
      'id', i.id, 'email', i.email, 'name', i.name, 'phone', i.phone, 'party_size', i.party_size,
      'paid', i.paid, 'rsvp', i.rsvp, 'notes', i.notes, 'token', i.token,
      'invited_at', i.invited_at, 'register_sent_at', i.register_sent_at, 'created_at', i.created_at,
      'player_id', i.player_id, 'player_name', p.display_name, 'player_avatar', p.avatar, 'player_emoji', p.emoji,
      'games', (select count(*) from public.scores s where s.player_id = i.player_id and s.event_id = i.event_id and not s.voided)
    ) order by lower(coalesce(i.name, i.email)))
    from public.event_invites i left join public.players p on p.id = i.player_id
    where i.event_id = p_event_id), '[]'::json);
end $$;

-- Add or edit one guest. p_id null = add. Email must be unique within the event.
create or replace function public.host_save_guest(p_pass text, p_event_id int, p_id bigint, p_name text, p_email text,
  p_phone text, p_party_size int, p_paid boolean, p_rsvp text, p_notes text)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint := p_id; v_email text := lower(btrim(coalesce(p_email, '')));
begin
  perform public._require_host(p_pass);
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email doesn''t look right.'; end if;
  if p_rsvp is not null and p_rsvp not in ('yes', 'maybe', 'no') then raise exception 'Bad RSVP.'; end if;
  if exists (select 1 from public.event_invites where event_id = p_event_id and email = v_email and id is distinct from v_id) then
    raise exception 'That email is already on the guest list.';
  end if;
  if v_id is null then
    insert into public.event_invites (event_id, email, name, phone, party_size, paid, rsvp, notes)
    values (p_event_id, v_email, nullif(btrim(coalesce(p_name, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''),
            greatest(1, least(20, coalesce(p_party_size, 1))), coalesce(p_paid, false), p_rsvp, nullif(btrim(coalesce(p_notes, '')), ''))
    returning id into v_id;
  else
    update public.event_invites set email = v_email, name = nullif(btrim(coalesce(p_name, '')), ''),
      phone = nullif(btrim(coalesce(p_phone, '')), ''), party_size = greatest(1, least(20, coalesce(p_party_size, 1))),
      paid = coalesce(p_paid, false), rsvp = p_rsvp, notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
    where id = v_id and event_id = p_event_id;
    if not found then raise exception 'Guest not found.'; end if;
  end if;
  return v_id;
end $$;

grant execute on function
  public.host_save_guest(text, int, bigint, text, text, text, int, boolean, text, text)
to anon, authenticated;
