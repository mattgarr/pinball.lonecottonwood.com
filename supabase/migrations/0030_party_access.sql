-- Party access (Nov 10): no more open sign-ups. join_party needs a party credential, checked here:
--   * the party QR key (a random secret printed in the party QR codes: /?k=<key>, /machine/N?k=<key>),
--   * the party password (two words + a number, said out loud / printed), checked with bcrypt,
--   * a guest's own ticket link token (event_invites.token, from the emailed sign-up link), or
--   * the token of a player already signed in on that phone (adding a partner on the same phone).
-- Wrong passwords are slow (bcrypt) and 20 wrong tries in a minute lock the PASSWORD for 1 minute,
-- party-wide. The QR key, ticket links and signed-in phones are never locked, so a griefer can't keep
-- real guests out. The host can pause new sign-ups (QR key + password) without touching ticket links.
-- Plus a public "Need help?" form that stores messages for the host (no emails are sent).
-- Safe to run more than once (keeps an existing password and key).

create table if not exists public.party_access (
  id            int primary key default 1 check (id = 1),
  join_key      text not null,
  join_pass     text not null,           -- shown to the host (to say out loud / print)
  join_pass_hash text not null,          -- bcrypt of the normalized password (what guests are checked against)
  signups_open  boolean not null default true,
  fail_count    int not null default 0,
  fail_since    timestamptz,
  locked_until  timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.party_access enable row level security;
revoke all on public.party_access from anon, authenticated;

-- "SILVER JACKPOT 42" style: easy to say, ~4 million combinations.
create or replace function public._friendly_password()
returns text language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  a text[] := array['silver','golden','lucky','turbo','cosmic','magic','neon','super','atomic','electric',
                    'rocket','thunder','wild','crazy','hyper','mega','pixel','retro','royal','flying',
                    'midnight','starlight','rapid','mystic','blazing','frosty','jumbo','shiny','spinning','groovy'];
  b text[] := array['flipper','jackpot','bumper','spinner','plunger','multiball','tilt','ramp','orbit','kicker',
                    'slingshot','rollover','replay','bonus','combo','skillshot','wizard','arcade','token','quarter',
                    'lanes','magnet','outlane','scoop','saucer','gobble','buzzer','chime','marquee','backglass'];
  i int := 1 + floor(random() * array_length(a, 1))::int;
  j int := 1 + floor(random() * array_length(b, 1))::int;
begin
  return upper(a[i] || ' ' || b[j] || ' ' || (10 + floor(random() * 90))::int);
end $$;

-- Guests can type it any way: "Silver-Jackpot 42" = "silverjackpot42".
create or replace function public._norm_pass(p text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9]', '', 'g'))
$$;

do $$
declare v text;
begin
  if not exists (select 1 from public.party_access where id = 1) then
    v := public._friendly_password();
    insert into public.party_access (id, join_key, join_pass, join_pass_hash)
    values (1, encode(extensions.gen_random_bytes(8), 'hex'), v, extensions.crypt(public._norm_pass(v), extensions.gen_salt('bf', 10)));
  end if;
end $$;

-- What a credential is: 'qr' | 'invite' | 'player' | 'password' | 'locked' | 'bad' | 'missing'.
-- Counts wrong passwords (callers must not raise afterwards, or the count rolls back).
create or replace function public._party_access_kind(p_access text)
returns text language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_k text := btrim(coalesce(p_access, ''));
  v_n text := public._norm_pass(p_access);
  a public.party_access%rowtype;
begin
  if v_k = '' then return 'missing'; end if;
  select * into a from public.party_access where id = 1 for update;
  if not found then return 'bad'; end if;
  if v_k = a.join_key then return 'qr'; end if;
  if length(v_k) <= 64 and exists (select 1 from public.event_invites where token = v_k) then return 'invite'; end if;
  if length(v_k) <= 64 and public._player_for_token(v_k) is not null then return 'player'; end if;
  if a.locked_until is not null and a.locked_until > now() then return 'locked'; end if;
  if length(v_n) between 4 and 60 and a.join_pass_hash = crypt(v_n, a.join_pass_hash) then return 'password'; end if;
  -- Wrong: 20 in a minute locks the password (not the QR key or ticket links) for a minute.
  if a.fail_since is null or a.fail_since < now() - interval '1 minute' then
    update public.party_access set fail_count = 1, fail_since = now() where id = 1;
  elsif a.fail_count + 1 >= 20 then
    update public.party_access set fail_count = 0, fail_since = null, locked_until = now() + interval '1 minute' where id = 1;
  else
    update public.party_access set fail_count = fail_count + 1 where id = 1;
  end if;
  return 'bad';
end $$;
revoke all on function public._friendly_password(), public._norm_pass(text), public._party_access_kind(text)
  from public, anon, authenticated;

-- A friendly message for a kind that can't sign up, or null if it can.
create or replace function public._party_access_error(p_kind text)
returns text language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if p_kind in ('invite', 'player') then return null; end if;
  if p_kind in ('qr', 'password') then
    if (select signups_open from public.party_access where id = 1) then return null; end if;
    return 'New sign-ups are paused right now. Find a host.';
  end if;
  if p_kind = 'locked' then return 'Too many wrong tries. Wait a minute, or scan the party QR code.'; end if;
  if p_kind = 'missing' then return 'You need the party password or the party QR code to join.'; end if;
  return 'That party password isn''t right. Check with a host.';
end $$;
revoke all on function public._party_access_error(text) from public, anon, authenticated;

-- Landing page: is this code good? {ok, kind, event_name} or {ok:false, error}.
create or replace function public.check_party_access(p_access text)
returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_kind text := public._party_access_kind(p_access); v_err text := public._party_access_error(v_kind);
begin
  if v_err is not null then return json_build_object('ok', false, 'error', v_err, 'kind', v_kind); end if;
  return json_build_object('ok', true, 'kind', v_kind,
    'event_name', (select name from public.events where id = public._current_event()));
end $$;
revoke all on function public.check_party_access(text) from public;
grant execute on function public.check_party_access(text) to anon, authenticated;

-- join_party now takes the credential (p_access). Credential problems come back as {error} (not an
-- exception) so wrong-password counting sticks; other problems still raise as before.
drop function if exists public.join_party(text, text, text, boolean, text);
create or replace function public.join_party(
  p_name text, p_pin text, p_emoji text default '🎯',
  p_first_timer boolean default false, p_avatar text default null, p_access text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_palette text[] := array['#ff5b6e','#ffb020','#ffd84d','#38d39f','#2ec5e8','#5b8cff',
                            '#a07bff','#ff6fd0','#7ee081','#ff8a4c','#4dd4c4','#c9a0ff'];
  v_count   int;
  v_id      bigint;
  v_err     text;
begin
  v_err := public._party_access_error(public._party_access_kind(p_access));
  if v_err is not null then return json_build_object('error', v_err, 'access', true); end if;
  if (select status from public.events where id = public._current_event()) <> 'open' then
    raise exception 'The event is closed to new players.';
  end if;
  if length(v_name) < 1 or length(v_name) > 24 then
    raise exception 'Pick a nickname (up to 24 characters).';
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    raise exception 'Your PIN must be exactly 4 digits.';
  end if;
  if exists (select 1 from public.players where lower(display_name) = lower(v_name)) then
    raise exception 'That nickname is taken. If it''s you, tap "Joined before?".';
  end if;
  if p_avatar is not null and (p_avatar !~ '^data:image/(jpeg|png|webp);base64,' or length(p_avatar) > 300000) then
    p_avatar := null;
  end if;
  select count(*) into v_count from public.players;
  insert into public.players (display_name, emoji, color, avatar, first_timer)
  values (v_name, left(coalesce(nullif(p_emoji, ''), '🎯'), 8),
          v_palette[(v_count % array_length(v_palette, 1)) + 1],
          p_avatar, coalesce(p_first_timer, false))
  returning id into v_id;
  insert into public.player_pins (player_id, pin_hash) values (v_id, crypt(p_pin, gen_salt('bf')));
  perform public._enter_event(v_id);
  return json_build_object('player_id', v_id, 'token', public._new_token(v_id));
end $$;
revoke all on function public.join_party(text, text, text, boolean, text, text) from public;
grant execute on function public.join_party(text, text, text, boolean, text, text) to anon, authenticated;

-- Host: see and change access. p_password: null = keep, '' = new random one, else that one.
create or replace function public.host_party_access(p_pass text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  return (select json_build_object('password', join_pass, 'key', join_key, 'signups_open', signups_open,
            'locked_until', case when locked_until > now() then locked_until end)
          from public.party_access where id = 1);
end $$;

create or replace function public.host_set_party_access(p_pass text, p_password text default null,
  p_new_key boolean default false, p_open boolean default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v text;
begin
  perform public._require_host(p_pass);
  if p_password is not null then
    v := upper(btrim(regexp_replace(p_password, '\s+', ' ', 'g')));
    if v = '' then v := public._friendly_password(); end if;
    if length(public._norm_pass(v)) < 6 or length(v) > 40 then
      raise exception 'Make the password 6 to 40 letters or numbers.';
    end if;
    update public.party_access set join_pass = v, join_pass_hash = crypt(public._norm_pass(v), gen_salt('bf', 10)),
      fail_count = 0, fail_since = null, locked_until = null, updated_at = now() where id = 1;
  end if;
  if coalesce(p_new_key, false) then
    update public.party_access set join_key = encode(gen_random_bytes(8), 'hex'), updated_at = now() where id = 1;
  end if;
  if p_open is not null then
    update public.party_access set signups_open = p_open, updated_at = now() where id = 1;
  end if;
  return public.host_party_access(p_pass);
end $$;
revoke all on function public.host_party_access(text), public.host_set_party_access(text, text, boolean, boolean) from public;
grant execute on function public.host_party_access(text), public.host_set_party_access(text, text, boolean, boolean) to anon, authenticated;

-- ------------------------------------------------------------- "Need help?" messages
create table if not exists public.help_requests (
  id         bigserial primary key,
  name       text not null check (length(name) between 1 and 80),
  contact    text check (contact is null or length(contact) <= 120),
  message    text not null check (length(message) between 1 and 1000),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
alter table public.help_requests enable row level security;
revoke all on public.help_requests from anon, authenticated;

-- Public. Capped: 30 messages an hour party-wide (it's a friends' party; stops a flood).
create or replace function public.send_help_request(p_name text, p_contact text, p_message text)
returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_contact text := nullif(btrim(coalesce(p_contact, '')), '');
  v_msg text := btrim(coalesce(p_message, ''));
begin
  if v_name = '' or v_msg = '' then return json_build_object('error', 'Add your name and a message.'); end if;
  if length(v_name) > 80 or length(coalesce(v_contact, '')) > 120 or length(v_msg) > 1000 then
    return json_build_object('error', 'That''s a bit long. Keep it under 1,000 characters.');
  end if;
  if (select count(*) from public.help_requests where created_at > now() - interval '1 hour') >= 30 then
    return json_build_object('error', 'Lots of messages right now. Try again in a bit, or find a host.');
  end if;
  insert into public.help_requests (name, contact, message) values (v_name, v_contact, v_msg);
  return json_build_object('ok', true);
end $$;
revoke all on function public.send_help_request(text, text, text) from public;
grant execute on function public.send_help_request(text, text, text) to anon, authenticated;

create or replace function public.host_help_requests(p_pass text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  return coalesce((select json_agg(r order by r.handled_at is not null, r.id desc) from (
    select id, name, contact, message, created_at, handled_at from public.help_requests
    order by id desc limit 100) r), '[]'::json);
end $$;

create or replace function public.host_help_done(p_pass text, p_id bigint, p_done boolean default true)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.help_requests set handled_at = case when p_done then now() end where id = p_id;
end $$;
revoke all on function public.host_help_requests(text), public.host_help_done(text, bigint, boolean) from public;
grant execute on function public.host_help_requests(text), public.host_help_done(text, bigint, boolean) to anon, authenticated;
