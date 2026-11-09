-- Event roster + invites: the host pastes guests' emails, sends each a personal join link
-- (pinball@lonecottonwood.com via the email-invites function). The link opens Join with the email
-- filled in; joining links the invite to the new player (and saves the email if they tick consent).
-- Invites are private: only the host RPCs and the service role can read them.
-- Safe to run more than once.

create table if not exists public.event_invites (
  id         bigserial primary key,
  event_id   int not null references public.events on delete cascade,
  email      text not null check (length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name       text check (name is null or length(name) <= 60),
  token      text not null unique default encode(gen_random_bytes(12), 'hex'),
  invited_at timestamptz,
  player_id  bigint references public.players on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, email)
);
alter table public.event_invites enable row level security;
grant select, update on public.event_invites to service_role;

-- Paste a list: one guest per line, "email", "Name <email>" or "Name, email".
create or replace function public.host_add_invites(p_pass text, p_event_id int, p_lines text)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_line text; v_email text; v_name text; v_n int := 0;
begin
  perform public._require_host(p_pass);
  if not exists (select 1 from public.events where id = p_event_id) then raise exception 'Event not found.'; end if;
  foreach v_line in array regexp_split_to_array(coalesce(p_lines, ''), E'[\\n;]+') loop
    v_email := lower(substring(v_line from '[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+'));
    continue when v_email is null;
    v_name := nullif(btrim(regexp_replace(replace(v_line, v_email, ''), '[<>,"]', '', 'g')), '');
    v_name := nullif(btrim(regexp_replace(coalesce(v_name, ''), '\S+@\S+', '', 'g')), '');
    insert into public.event_invites (event_id, email, name) values (p_event_id, v_email, left(v_name, 60))
    on conflict (event_id, email) do update set name = coalesce(excluded.name, event_invites.name);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.host_invites(p_pass text, p_event_id int)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  return coalesce((
    select json_agg(json_build_object('id', i.id, 'email', i.email, 'name', i.name, 'invited_at', i.invited_at,
                                      'player_id', i.player_id, 'player_name', p.display_name) order by i.created_at)
    from public.event_invites i left join public.players p on p.id = i.player_id
    where i.event_id = p_event_id), '[]'::json);
end $$;

create or replace function public.host_remove_invite(p_pass text, p_invite_id bigint)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  delete from public.event_invites where id = p_invite_id;
end $$;

-- The invite link: who it's for and which event (only the link holder sees their own email).
create or replace function public.invite_info(p_invite text)
returns json language sql stable security definer set search_path = public, extensions as $$
  select json_build_object('email', i.email, 'name', i.name, 'event_name', e.name, 'event_date', e.starts_on,
                           'joined', i.player_id is not null)
  from public.event_invites i join public.events e on e.id = i.event_id
  where i.token = coalesce(p_invite, '')
$$;

-- After joining from an invite: link it, and save the email for results if they ticked consent.
create or replace function public.claim_invite(p_token text, p_invite text, p_consent boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token); v_email text;
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  update public.event_invites set player_id = v_pid where token = coalesce(p_invite, '') returning email into v_email;
  if v_email is not null and coalesce(p_consent, false) then
    insert into public.player_contacts (player_id, email, consent_at) values (v_pid, v_email, now())
    on conflict (player_id) do update set email = excluded.email, consent_at = now();
  end if;
end $$;

grant execute on function
  public.host_add_invites(text, int, text),
  public.host_invites(text, int),
  public.host_remove_invite(text, bigint),
  public.invite_info(text),
  public.claim_invite(text, text, boolean)
to anon, authenticated;
