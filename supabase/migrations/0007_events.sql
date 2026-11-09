-- Events: one permanent player database, many events (tournaments/parties).
-- * events: name, date, status, reveal state. party.current_event_id points at the live one, and the
--   party row keeps mirroring the current event's status/reveal so existing screens keep working.
-- * event_machines: which machines count in each event. event_entries: who's in each event
--   (guests are entered automatically when they join, rejoin, open the app, or log a score).
-- * scores.event_id: every score belongs to one event. Existing scores become event 1.
-- * player_contacts: optional email + consent for results emails. Never readable from the browser.
-- Also: original selfies (players.selfie) were readable by anyone; now only safe columns are.
-- Safe to run more than once.

create table if not exists public.events (
  id            serial primary key,
  name          text not null check (length(btrim(name)) between 1 and 60),
  starts_on     date,
  status        text not null default 'open' check (status in ('open', 'closed')),
  reveal_active boolean not null default false,
  match_digits  int check (match_digits between 0 and 99),
  results_sent_at timestamptz,
  created_at    timestamptz not null default now()
);
create table if not exists public.event_machines (
  event_id   int not null references public.events on delete cascade,
  machine_id int not null references public.machines on delete cascade,
  primary key (event_id, machine_id)
);
create table if not exists public.event_entries (
  event_id  int not null references public.events on delete cascade,
  player_id bigint not null references public.players on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (event_id, player_id)
);
create table if not exists public.player_contacts (
  player_id  bigint primary key references public.players on delete cascade,
  email      text not null check (length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  consent_at timestamptz not null default now()
);

alter table public.party  add column if not exists current_event_id int references public.events;
alter table public.scores add column if not exists event_id int references public.events;

-- Event 1 = the current party, with everything that exists today.
insert into public.events (id, name, starts_on, status, reveal_active, match_digits)
select 1, 'The Auction Party', date '2026-11-14', status, reveal_active, match_digits from public.party where id = 1
on conflict (id) do nothing;
select setval(pg_get_serial_sequence('public.events', 'id'), greatest((select max(id) from public.events), 1));
insert into public.event_machines (event_id, machine_id) select 1, id from public.machines where active on conflict do nothing;
update public.party set current_event_id = 1 where id = 1 and current_event_id is null;
update public.scores set event_id = 1 where event_id is null;
insert into public.event_entries (event_id, player_id) select 1, id from public.players on conflict do nothing;
create index if not exists scores_event on public.scores (event_id);

-- ------------------------------------------------------------- access
alter table public.events          enable row level security;
alter table public.event_machines  enable row level security;
alter table public.event_entries   enable row level security;
alter table public.player_contacts enable row level security;
drop policy if exists "public read" on public.events;
drop policy if exists "public read" on public.event_machines;
drop policy if exists "public read" on public.event_entries;
create policy "public read" on public.events         for select to anon, authenticated using (true);
create policy "public read" on public.event_machines for select to anon, authenticated using (true);
create policy "public read" on public.event_entries  for select to anon, authenticated using (true);
grant select on public.events, public.event_machines, public.event_entries to anon, authenticated;
grant select on public.events, public.event_machines, public.event_entries, public.player_contacts to service_role;
-- player_contacts: no anon/authenticated grants or policies -> unreachable from the browser.

-- Selfies stay private: the browser may only read these player columns.
revoke select on public.players from anon, authenticated;
grant select (id, display_name, emoji, color, avatar, first_timer, created_at) on public.players to anon, authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.events; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.event_entries; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.event_machines; exception when duplicate_object then null; end;
end $$;

-- ------------------------------------------------------------- helpers
create or replace function public._current_event()
returns int language sql stable security definer set search_path = public as $$
  select current_event_id from public.party where id = 1
$$;
create or replace function public._enter_event(p_player_id bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.event_entries (event_id, player_id)
  select public._current_event(), p_player_id where public._current_event() is not null
  on conflict do nothing
$$;
revoke all on function public._current_event(), public._enter_event(bigint) from public, anon, authenticated;

-- ------------------------------------------------------------- players
create or replace function public.join_party(
  p_name text, p_pin text, p_emoji text default '🎯',
  p_first_timer boolean default false, p_avatar text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_palette text[] := array['#ff5b6e','#ffb020','#ffd84d','#38d39f','#2ec5e8','#5b8cff',
                            '#a07bff','#ff6fd0','#7ee081','#ff8a4c','#4dd4c4','#c9a0ff'];
  v_count   int;
  v_id      bigint;
begin
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

create or replace function public.rejoin(p_player_id bigint, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v public.player_pins%rowtype;
begin
  select * into v from public.player_pins where player_id = p_player_id;
  if not found then return json_build_object('error', 'Player not found.'); end if;
  if v.locked_until is not null and v.locked_until > now() then
    return json_build_object('error', 'Too many tries. Wait 2 minutes, or ask the host to reset your PIN.');
  end if;
  if v.pin_hash <> crypt(coalesce(p_pin, ''), v.pin_hash) then
    if v.failed_attempts + 1 >= 5 then
      update public.player_pins set failed_attempts = 0, locked_until = now() + interval '2 minutes'
      where player_id = p_player_id;
    else
      update public.player_pins set failed_attempts = failed_attempts + 1 where player_id = p_player_id;
    end if;
    return json_build_object('error', 'Wrong PIN.');
  end if;
  update public.player_pins set failed_attempts = 0, locked_until = null where player_id = p_player_id;
  perform public._enter_event(p_player_id);
  return json_build_object('player_id', p_player_id, 'token', public._new_token(p_player_id));
end $$;

-- Opening the app while signed in enters you into the current event (auto-enter on scan).
create or replace function public.enter_current_event(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token);
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  perform public._enter_event(v_pid);
end $$;

-- whoami now also says whether results emails are on (never the address itself).
create or replace function public.whoami(p_token text)
returns json language sql stable security definer set search_path = public, extensions as $$
  select row_to_json(p) from (
    select id, display_name, emoji, color, avatar, first_timer,
           exists (select 1 from public.player_contacts c where c.player_id = players.id) as has_email
    from public.players where id = public._player_for_token(p_token)
  ) p
$$;

-- Results email opt-in. Pass null/empty email or consent=false to turn it off.
create or replace function public.set_my_email(p_token text, p_email text, p_consent boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token); v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  if not coalesce(p_consent, false) or v_email = '' then
    delete from public.player_contacts where player_id = v_pid;
    return;
  end if;
  if length(v_email) > 200 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email doesn''t look right.'; end if;
  insert into public.player_contacts (player_id, email, consent_at) values (v_pid, v_email, now())
  on conflict (player_id) do update set email = excluded.email, consent_at = now();
end $$;

-- ------------------------------------------------------------- scores
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

create or replace function public.host_add_score(p_pass text, p_player_id bigint, p_machine_id int, p_value bigint)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  perform public._enter_event(p_player_id);
  insert into public.scores (player_id, machine_id, value, event_id) values (p_player_id, p_machine_id, p_value, public._current_event());
end $$;

-- ------------------------------------------------------------- host: event state (mirrored onto party)
create or replace function public.host_set_status(p_pass text, p_status text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.events set status = p_status where id = public._current_event();
  update public.party set status = p_status, updated_at = now() where id = 1;
end $$;

create or replace function public.host_reveal(p_pass text, p_active boolean, p_match_digits int default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.events set reveal_active = p_active,
    match_digits = case when p_active then p_match_digits else match_digits end
  where id = public._current_event();
  update public.party set reveal_active = p_active,
    match_digits = case when p_active then p_match_digits else match_digits end, updated_at = now()
  where id = 1;
end $$;

-- ------------------------------------------------------------- host: events
create or replace function public.host_save_event(p_pass text, p_event_id int, p_name text, p_starts_on date, p_machine_ids int[], p_make_current boolean default false)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_id int := p_event_id;
begin
  perform public._require_host(p_pass);
  if length(btrim(coalesce(p_name, ''))) < 1 then raise exception 'Give the event a name.'; end if;
  if coalesce(array_length(p_machine_ids, 1), 0) = 0 then raise exception 'Pick at least one machine.'; end if;
  if v_id is null then
    insert into public.events (name, starts_on) values (btrim(p_name), p_starts_on) returning id into v_id;
  else
    update public.events set name = btrim(p_name), starts_on = p_starts_on where id = v_id;
    if not found then raise exception 'Event not found.'; end if;
  end if;
  delete from public.event_machines where event_id = v_id and machine_id <> all (p_machine_ids);
  insert into public.event_machines (event_id, machine_id)
  select v_id, m.id from public.machines m where m.id = any (p_machine_ids) on conflict do nothing;
  if p_make_current then perform public.host_set_current_event(p_pass, v_id); end if;
  return v_id;
end $$;

create or replace function public.host_set_current_event(p_pass text, p_event_id int)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare e public.events%rowtype;
begin
  perform public._require_host(p_pass);
  select * into e from public.events where id = p_event_id;
  if not found then raise exception 'Event not found.'; end if;
  update public.party set current_event_id = e.id, name = e.name, status = e.status,
    reveal_active = e.reveal_active, match_digits = e.match_digits, updated_at = now()
  where id = 1;
end $$;

create or replace function public.host_delete_event(p_pass text, p_event_id int, p_confirm text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  if p_confirm <> 'DELETE' then raise exception 'Type DELETE to confirm.'; end if;
  if p_event_id = public._current_event() then raise exception 'Switch to another event first.'; end if;
  delete from public.scores where event_id = p_event_id;
  delete from public.events where id = p_event_id;
end $$;

-- Wipe test data before the party: all players and scores; events and machine lists stay.
create or replace function public.host_wipe(p_pass text, p_confirm text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  if p_confirm <> 'WIPE' then raise exception 'Type WIPE to confirm.'; end if;
  delete from public.scores where true;
  delete from public.photo_reads where true;
  delete from public.players where true;
  update public.events set status = 'open', reveal_active = false, match_digits = null, results_sent_at = null where true;
  update public.party set status = 'open', reveal_active = false, match_digits = null, updated_at = now() where id = 1;
end $$;

grant execute on function
  public.enter_current_event(text),
  public.set_my_email(text, text, boolean),
  public.host_save_event(text, int, text, date, int[], boolean),
  public.host_set_current_event(text, int),
  public.host_delete_event(text, int, text)
to anon, authenticated;

-- email-results stamps results_sent_at with the service role.
grant update (results_sent_at) on public.events to service_role;
