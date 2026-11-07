-- Pinball Wizard — Supabase schema.
-- Model: the website is static (GitHub Pages). All shared state lives here.
--   * Anyone can READ the leaderboard tables (machines, players, scores, party).
--   * Nobody can WRITE tables directly. Every write goes through a SECURITY DEFINER
--     function below, which checks the player's token or the host passcode.
--   * Secrets (login tokens, PINs, host passcode) live in tables the public can't see,
--     and are stored hashed.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables
create table public.machines (
  id           int primary key,
  name         text not null,
  manufacturer text,
  year         int,
  display_type text,
  sort_order   int not null default 0,
  active       boolean not null default true
);

create table public.players (
  id           bigint generated always as identity primary key,
  display_name text not null,
  emoji        text not null default '🎯',
  color        text not null,
  avatar       text,                       -- small data: URL selfie, optional
  first_timer  boolean not null default false,
  created_at   timestamptz not null default now()
);
create unique index players_name_ci on public.players (lower(display_name));

create table public.player_tokens (        -- one row per signed-in phone
  token_hash text primary key,
  player_id  bigint not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.player_pins (
  player_id       bigint primary key references public.players(id) on delete cascade,
  pin_hash        text not null,
  failed_attempts int not null default 0,
  locked_until    timestamptz
);

create table public.scores (
  id         bigint generated always as identity primary key,
  player_id  bigint not null references public.players(id) on delete cascade,
  machine_id int not null references public.machines(id),
  value      bigint not null check (value >= 0),
  voided     boolean not null default false,
  created_at timestamptz not null default now()
);
create index scores_player  on public.scores (player_id);
create index scores_machine on public.scores (machine_id);

create table public.party (
  id            int primary key default 1 check (id = 1),
  name          text not null default 'Pinball Wizard',
  status        text not null default 'open' check (status in ('open', 'closed')),
  reveal_active boolean not null default false,
  match_digits  int check (match_digits between 0 and 99),
  updated_at    timestamptz not null default now()
);
insert into public.party (id) values (1);

create table public.host_secret (
  id        int primary key default 1 check (id = 1),
  pass_hash text not null
);

-- ---------------------------------------------------------------- seed
insert into public.machines (id, name, manufacturer, year, display_type, sort_order) values
  (1, 'Centaur',            'Bally',    1981, '7-segment',    1),
  (2, 'Fathom',             'Bally',    1981, '7-segment',    2),
  (3, 'Whirlwind',          'Williams', 1990, 'alphanumeric', 3),
  (4, 'White Water',        'Williams', 1993, 'dot-matrix',   4),
  (5, 'Cactus Canyon',      'Bally',    1998, 'dot-matrix',   5),
  (6, 'Dungeons & Dragons', 'Stern',    2025, 'modern-lcd',   6);

-- ---------------------------------------------------------------- access
alter table public.machines      enable row level security;
alter table public.players       enable row level security;
alter table public.player_tokens enable row level security;
alter table public.player_pins   enable row level security;
alter table public.scores        enable row level security;
alter table public.party         enable row level security;
alter table public.host_secret   enable row level security;

create policy "public read" on public.machines for select to anon, authenticated using (true);
create policy "public read" on public.players  for select to anon, authenticated using (true);
create policy "public read" on public.scores   for select to anon, authenticated using (true);
create policy "public read" on public.party    for select to anon, authenticated using (true);

grant select on public.machines, public.players, public.scores, public.party to anon, authenticated;
-- player_tokens, player_pins, host_secret: no grants, no policies -> unreachable from the API.

-- live updates for the TV and phones
alter publication supabase_realtime add table public.players, public.scores, public.party;

-- ---------------------------------------------------------------- internal helpers
create or replace function public._player_for_token(p_token text)
returns bigint language sql stable security definer set search_path = public, extensions as $$
  select player_id from public.player_tokens
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public._new_token(p_player_id bigint)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(gen_random_bytes(24), 'hex');
begin
  insert into public.player_tokens (token_hash, player_id)
  values (encode(digest(v_token, 'sha256'), 'hex'), p_player_id);
  return v_token;
end $$;

create or replace function public._require_host(p_pass text)
returns void language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.host_secret where pass_hash = crypt(coalesce(p_pass, ''), pass_hash)) then
    raise exception 'Wrong host passcode.';
  end if;
end $$;

revoke all on function public._player_for_token(text), public._new_token(bigint), public._require_host(text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- player functions
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
  if (select status from public.party where id = 1) <> 'open' then
    raise exception 'The party is closed to new players.';
  end if;
  if length(v_name) < 1 or length(v_name) > 24 then
    raise exception 'Pick a nickname (up to 24 characters).';
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    raise exception 'Your PIN must be exactly 4 digits.';
  end if;
  if exists (select 1 from public.players where lower(display_name) = lower(v_name)) then
    raise exception 'That nickname is taken. If it''s you, tap "I already joined".';
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
  return json_build_object('player_id', v_id, 'token', public._new_token(v_id));
end $$;

-- Rejoin on a new/cleared phone: pick your name, enter your PIN.
-- Returns {error} instead of raising, so the failed-attempt counter isn't rolled back.
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
  return json_build_object('player_id', p_player_id, 'token', public._new_token(p_player_id));
end $$;

create or replace function public.whoami(p_token text)
returns json language sql stable security definer set search_path = public, extensions as $$
  select row_to_json(p) from (
    select id, display_name, emoji, color, avatar, first_timer
    from public.players where id = public._player_for_token(p_token)
  ) p
$$;

create or replace function public.submit_score(p_token text, p_machine_id int, p_value bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint; v_id bigint;
begin
  if (select status from public.party where id = 1) <> 'open' then
    raise exception 'The party is closed, so scores are locked.';
  end if;
  v_pid := public._player_for_token(p_token);
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  if not exists (select 1 from public.machines where id = p_machine_id and active) then
    raise exception 'Unknown machine.';
  end if;
  if p_value is null or p_value < 0 or p_value > 99999999999 then
    raise exception 'That score looks off.';
  end if;
  -- swallow an accidental double-tap of the same score
  select id into v_id from public.scores
  where player_id = v_pid and machine_id = p_machine_id and value = p_value and not voided
    and created_at > now() - interval '60 seconds'
  limit 1;
  if v_id is not null then return json_build_object('score_id', v_id, 'duplicate', true); end if;

  insert into public.scores (player_id, machine_id, value) values (v_pid, p_machine_id, p_value)
  returning id into v_id;
  return json_build_object('score_id', v_id);
end $$;

-- A player can take back a typo within 15 minutes.
create or replace function public.undo_score(p_token text, p_score_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token);
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  update public.scores set voided = true
  where id = p_score_id and player_id = v_pid and created_at > now() - interval '15 minutes';
  if not found then raise exception 'Only your own scores from the last 15 minutes can be undone.'; end if;
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- host functions
create or replace function public.host_check(p_pass text)
returns boolean language plpgsql stable security definer set search_path = public, extensions as $$
begin
  return exists (select 1 from public.host_secret where pass_hash = crypt(coalesce(p_pass, ''), pass_hash));
end $$;

create or replace function public.host_set_status(p_pass text, p_status text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.party set status = p_status, updated_at = now() where id = 1;
end $$;

create or replace function public.host_reveal(p_pass text, p_active boolean, p_match_digits int default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.party set reveal_active = p_active,
    match_digits = case when p_active then p_match_digits else match_digits end,
    updated_at = now()
  where id = 1;
end $$;

create or replace function public.host_void(p_pass text, p_score_id bigint, p_voided boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.scores set voided = p_voided where id = p_score_id;
end $$;

create or replace function public.host_add_score(p_pass text, p_player_id bigint, p_machine_id int, p_value bigint)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  insert into public.scores (player_id, machine_id, value) values (p_player_id, p_machine_id, p_value);
end $$;

create or replace function public.host_reset_pin(p_pass text, p_player_id bigint, p_new_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  if coalesce(p_new_pin, '') !~ '^[0-9]{4}$' then raise exception 'PIN must be exactly 4 digits.'; end if;
  update public.player_pins set pin_hash = crypt(p_new_pin, gen_salt('bf')), failed_attempts = 0, locked_until = null
  where player_id = p_player_id;
end $$;

create or replace function public.host_remove_player(p_pass text, p_player_id bigint)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  delete from public.players where id = p_player_id;  -- cascades to scores, tokens, pin
end $$;

-- Clear every player and score (use once, right before the party, to remove test data).
create or replace function public.host_wipe(p_pass text, p_confirm text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  if p_confirm <> 'WIPE' then raise exception 'Type WIPE to confirm.'; end if;
  delete from public.scores where true;
  delete from public.players where true;
  update public.party set status = 'open', reveal_active = false, match_digits = null, updated_at = now() where id = 1;
end $$;

grant execute on function
  public.join_party(text, text, text, boolean, text),
  public.rejoin(bigint, text),
  public.whoami(text),
  public.submit_score(text, int, bigint),
  public.undo_score(text, bigint),
  public.host_check(text),
  public.host_set_status(text, text),
  public.host_reveal(text, boolean, int),
  public.host_void(text, bigint, boolean),
  public.host_add_score(text, bigint, int, bigint),
  public.host_reset_pin(text, bigint, text),
  public.host_remove_player(text, bigint),
  public.host_wipe(text, text)
to anon, authenticated;
