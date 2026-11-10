-- Party-night hardening (Nov 10). Safe to run more than once; backward compatible with the old site.
-- * Nicknames: a short blocklist of offensive words (case-insensitive, light leetspeak), checked by a
--   trigger on players, so join_party, host renames and host-added players all go through it.
-- * players.avatar_updated_at: phones re-download a portrait only when it changed.
-- * host_rename_player, host_add_player (a player without a phone: no PIN).
-- * Scores: one game per player per machine every 2 minutes (host-added scores exempt); the
--   double-check queue flags only no-photo tournament scores that are a personal best landing in
--   that machine's top 3 (it used to flag every score logged for a friend without a photo).
-- * host_add_score: a retried add (same player, machine and value within 10 min) isn't added twice.
-- * tv_status + tv_heartbeat: the TV reports the reveal step it's showing; the host page reads it.
-- * award_snapshots + host_save_awards + party.awards_at: the prizes frozen at "Start the reveal".
-- * host_clear_scores also forgets the awards snapshot.

-- ------------------------------------------------------------- nicknames
create or replace function public._bad_name(p text)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  -- light leetspeak: 0→o 1→i 3→e 4→a 5→s 7→t @→a $→s !→i |→i 8→b
  v text := translate(lower(coalesce(p, '')), '013457@$!|8', 'oieastasiib');
  toks text[];
  t text; sq text; letters text := '';
  subs text[] := array['fuck','fvck','phuck','shit','cunt','bitch','nigg','whore','slut','porn','penis','vagina',
                       'nazi','hitler','retard','twat','wank','jizz','faggot','dildo','asshole','pussy','motherf',
                       'bastard','blowjob','handjob','cumshot','molest'];
  words text[] := array['ass','asses','cock','cocks','dick','dicks','cum','rape','fag','fags','tit','tits','titty',
                        'boob','boobs','sex','sexy','kkk','nude','nudes','anal','anus','piss','arse','sob','wtf','stfu'];
  w text;
begin
  toks := regexp_split_to_array(v, '[^a-z]+');
  foreach t in array toks loop
    if t = '' then continue; end if;
    sq := regexp_replace(t, '(.)\1+', '\1', 'g'); -- "fuuuck" → "fuck"
    foreach w in array subs loop
      if position(w in t) > 0 or position(w in sq) > 0 then return true; end if;
    end loop;
    if t = any(words) or sq = any(words) then return true; end if;
    -- spaced-out letters ("f u c k", "s.h.i.t") are checked joined up
    if length(t) = 1 then letters := letters || t; else letters := letters || ' '; end if;
  end loop;
  foreach t in array regexp_split_to_array(btrim(letters), ' +') loop
    if length(t) < 3 then continue; end if;
    foreach w in array subs loop
      if position(w in t) > 0 then return true; end if;
    end loop;
    if t = any(words) then return true; end if;
  end loop;
  return false;
end $$;
revoke all on function public._bad_name(text) from public, anon, authenticated;

alter table public.players add column if not exists avatar_updated_at timestamptz default now();
grant select (avatar_updated_at) on public.players to anon, authenticated;

create or replace function public._players_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' or new.display_name is distinct from old.display_name) and public._bad_name(new.display_name) then
    raise exception 'Please pick a different nickname (it''s a family party!).';
  end if;
  if tg_op = 'INSERT' or new.avatar is distinct from old.avatar then
    new.avatar_updated_at := clock_timestamp();
  end if;
  return new;
end $$;
revoke all on function public._players_guard() from public, anon, authenticated;
drop trigger if exists players_guard on public.players;
create trigger players_guard before insert or update on public.players
  for each row execute function public._players_guard();

-- ------------------------------------------------------------- host: rename / add a player
create or replace function public.host_rename_player(p_pass text, p_player_id bigint, p_name text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  perform public._require_host(p_pass);
  if length(v) < 1 or length(v) > 24 then raise exception 'Pick a nickname (up to 24 characters).'; end if;
  if exists (select 1 from public.players where lower(display_name) = lower(v) and id <> p_player_id) then
    raise exception 'That nickname is taken.';
  end if;
  update public.players set display_name = v where id = p_player_id;
  if not found then raise exception 'Player not found.'; end if;
  return json_build_object('ok', true, 'name', v);
end $$;
revoke all on function public.host_rename_player(text, bigint, text) from public;
grant execute on function public.host_rename_player(text, bigint, text) to anon, authenticated;

-- A player without a phone: name + emoji, no PIN (nobody can sign in as them until the host sets one
-- with Reset PIN). A retried tap returns the player it just made instead of "name taken".
create or replace function public.host_add_player(p_pass text, p_name text, p_emoji text default '🎯')
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_palette text[] := array['#ff5b6e','#ffb020','#ffd84d','#38d39f','#2ec5e8','#5b8cff',
                            '#a07bff','#ff6fd0','#7ee081','#ff8a4c','#4dd4c4','#c9a0ff'];
  v_id bigint; v_count int;
begin
  perform public._require_host(p_pass);
  if length(v_name) < 1 or length(v_name) > 24 then raise exception 'Pick a nickname (up to 24 characters).'; end if;
  select id into v_id from public.players p
  where lower(display_name) = lower(v_name) and created_at > now() - interval '2 minutes'
    and not exists (select 1 from public.player_pins pp where pp.player_id = p.id);
  if v_id is null then
    if exists (select 1 from public.players where lower(display_name) = lower(v_name)) then
      raise exception 'That nickname is taken.';
    end if;
    select count(*) into v_count from public.players;
    insert into public.players (display_name, emoji, color)
    values (v_name, left(coalesce(nullif(p_emoji, ''), '🎯'), 8), v_palette[(v_count % array_length(v_palette, 1)) + 1])
    returning id into v_id;
  end if;
  perform public._enter_event(v_id);
  return json_build_object('player_id', v_id);
end $$;
revoke all on function public.host_add_player(text, text, text) from public;
grant execute on function public.host_add_player(text, text, text) to anon, authenticated;

-- ------------------------------------------------------------- scores
-- Same as 0026, plus: one game per player per machine every 2 minutes, and the narrower review rule.
create or replace function public._insert_score(p_player_id bigint, p_logged_by bigint, p_machine_id int, p_value bigint, p_photo_path text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_dup_id bigint; v_dup_by bigint; v_ev int := public._current_event(); v_fp boolean;
  v_top bigint; v_mine bigint; v_above int; v_others int; v_review boolean;
begin
  if v_ev is null or (select status from public.events where id = v_ev) <> 'open' then
    raise exception 'The event is closed, so scores are locked.';
  end if;
  v_fp := public._is_free_play(v_ev);
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
  -- A duplicate is the same game only within the same kind (a re-sent score merges: retries are safe).
  select id, coalesce(logged_by, player_id) into v_dup_id, v_dup_by
  from public.scores
  where player_id = p_player_id and machine_id = p_machine_id and value = p_value and not voided
    and event_id = v_ev and free_play = v_fp and created_at > now() - interval '45 minutes'
  order by id limit 1;
  if v_dup_id is not null then
    if p_photo_path is not null then
      update public.scores set photo_path = p_photo_path where id = v_dup_id and photo_path is null;
    end if;
    return json_build_object('score_id', v_dup_id, 'duplicate', true, 'logged_by', v_dup_by, 'free_play', v_fp);
  end if;

  -- Nobody finishes two games on one machine in under 2 minutes.
  if exists (select 1 from public.scores where player_id = p_player_id and machine_id = p_machine_id and not voided
             and event_id = v_ev and created_at > now() - interval '2 minutes') then
    raise exception 'One game per machine every 2 minutes. Wrong number? Undo it first.';
  end if;

  perform public._enter_event(p_player_id);
  -- Double-check queue (tournament scores only): no photo, a personal best on this machine, and it lands in
  -- the machine's top 3. Early on (fewer than 3 other players there) only a new #1 is flagged.
  if not v_fp and p_photo_path is null then
    select max(value) into v_top from public.scores
    where machine_id = p_machine_id and event_id = v_ev and not voided and not free_play;
    select max(value) into v_mine from public.scores
    where machine_id = p_machine_id and event_id = v_ev and not voided and not free_play and player_id = p_player_id;
    select count(*) filter (where b >= p_value), count(*) into v_above, v_others from (
      select max(value) b from public.scores
      where machine_id = p_machine_id and event_id = v_ev and not voided and not free_play and player_id <> p_player_id
      group by player_id) x;
    v_review := p_value > coalesce(v_mine, -1) and v_above < 3
      and (v_others >= 3 or (v_top is not null and p_value > v_top));
  else
    v_review := false;
  end if;
  insert into public.scores (player_id, machine_id, value, logged_by, photo_path, needs_review, event_id, free_play)
  values (p_player_id, p_machine_id, p_value, nullif(p_logged_by, p_player_id), p_photo_path, coalesce(v_review, false), v_ev, v_fp)
  returning id into v_id;
  return json_build_object('score_id', v_id, 'duplicate', false, 'logged_by', p_logged_by, 'free_play', v_fp);
end $$;
revoke all on function public._insert_score(bigint, bigint, int, bigint, text) from public, anon, authenticated;

-- Same as 0026, plus: a retried add (timeout, double tap) doesn't add the same score twice.
create or replace function public.host_add_score(p_pass text, p_player_id bigint, p_machine_id int, p_value bigint, p_counts boolean default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_ev int := public._current_event();
begin
  perform public._require_host(p_pass);
  perform pg_advisory_xact_lock(hashtextextended('score:' || p_player_id || ':' || p_machine_id, 0));
  if exists (select 1 from public.scores where player_id = p_player_id and machine_id = p_machine_id and value = p_value
             and not voided and event_id = v_ev and created_at > now() - interval '10 minutes') then
    return;
  end if;
  perform public._enter_event(p_player_id);
  insert into public.scores (player_id, machine_id, value, event_id, free_play, kind_set_by_host)
  values (p_player_id, p_machine_id, p_value, v_ev,
          case when p_counts is null then public._is_free_play(v_ev) else not p_counts end, p_counts is not null);
end $$;
revoke all on function public.host_add_score(text, bigint, int, bigint, boolean) from public;
grant execute on function public.host_add_score(text, bigint, int, bigint, boolean) to anon, authenticated;

-- ------------------------------------------------------------- TV heartbeat
create table if not exists public.tv_status (
  id      int primary key default 1 check (id = 1),
  seen_at timestamptz,
  step    int,
  mode    text
);
alter table public.tv_status enable row level security;
drop policy if exists "public read" on public.tv_status;
create policy "public read" on public.tv_status for select to anon, authenticated using (true);
grant select on public.tv_status to anon, authenticated;
insert into public.tv_status (id) values (1) on conflict (id) do nothing;

create or replace function public.tv_heartbeat(p_step int, p_mode text)
returns void language sql security definer set search_path = public, extensions as $$
  update public.tv_status set seen_at = now(), step = greatest(0, least(coalesce(p_step, 0), 99)),
    mode = case when p_mode in ('reveal', 'board') then p_mode else 'board' end
  where id = 1
$$;
revoke all on function public.tv_heartbeat(int, text) from public;
grant execute on function public.tv_heartbeat(int, text) to anon, authenticated;

-- ------------------------------------------------------------- awards snapshot
create table if not exists public.award_snapshots (
  event_id int primary key references public.events(id) on delete cascade,
  snapshot jsonb not null,
  saved_at timestamptz not null default now()
);
alter table public.award_snapshots enable row level security;
drop policy if exists "public read" on public.award_snapshots;
create policy "public read" on public.award_snapshots for select to anon, authenticated using (true);
grant select on public.award_snapshots to anon, authenticated, service_role;
alter table public.party add column if not exists awards_at timestamptz;

-- p_force = false keeps a snapshot already saved for this event.
create or replace function public.host_save_awards(p_pass text, p_snapshot jsonb, p_force boolean default false)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_ev int := public._current_event();
begin
  perform public._require_host(p_pass);
  if v_ev is null then raise exception 'No active event.'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' or p_snapshot->'v' is null
     or jsonb_typeof(p_snapshot->'scores') <> 'array' then
    raise exception 'That awards snapshot looks wrong.';
  end if;
  if length(p_snapshot::text) > 800000 then raise exception 'That awards snapshot is too big.'; end if;
  if not coalesce(p_force, false) and exists (select 1 from public.award_snapshots where event_id = v_ev) then
    return json_build_object('kept', true);
  end if;
  insert into public.award_snapshots (event_id, snapshot, saved_at) values (v_ev, p_snapshot, now())
  on conflict (event_id) do update set snapshot = excluded.snapshot, saved_at = excluded.saved_at;
  update public.party set awards_at = now() where id = 1;
  return json_build_object('saved', true);
end $$;
revoke all on function public.host_save_awards(text, jsonb, boolean) from public;
grant execute on function public.host_save_awards(text, jsonb, boolean) to anon, authenticated;

-- Same as 0027, plus: the awards snapshot goes too.
create or replace function public.host_clear_scores(p_pass text, p_confirm text)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_n int; v_ev int := public._current_event();
begin
  perform public._require_host(p_pass);
  if p_confirm <> 'CLEAR' then raise exception 'Type CLEAR to confirm.'; end if;
  select count(*) into v_n from public.scores where event_id = v_ev;
  delete from public.scores where event_id = v_ev;
  delete from public.award_snapshots where event_id = v_ev;
  update public.events set reveal_active = false, match_digits = null, results_sent_at = null,
    free_play = false, free_play_at = null, revealed_at = null where id = v_ev;
  perform public._mirror_party();
  update public.party set awards_at = now() where id = 1;
  return v_n;
end $$;
