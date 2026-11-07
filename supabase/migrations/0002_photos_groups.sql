-- Photo proof, AI score reading, group logging, host review flags.

alter table public.scores
  add column if not exists logged_by    bigint references public.players(id) on delete set null,
  add column if not exists photo_path   text,
  add column if not exists needs_review boolean not null default false;

-- Public bucket for score-display photos (written only by the read-score edge function).
insert into storage.buckets (id, name, public)
values ('score-photos', 'score-photos', true)
on conflict (id) do nothing;

-- Rate limit for AI reads (protects the Gemini credits).
create table if not exists public.photo_reads (
  id         bigint generated always as identity primary key,
  player_id  bigint not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.photo_reads enable row level security;

-- Called only by the edge function (service role): validates the player token and the rate limit.
create or replace function public.photo_gate(p_token text)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token);
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  if (select count(*) from public.photo_reads where player_id = v_pid and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'Too many photos this hour. Type the score instead.';
  end if;
  insert into public.photo_reads (player_id) values (v_pid);
  return v_pid;
end $$;
revoke all on function public.photo_gate(text) from public, anon, authenticated;
grant execute on function public.photo_gate(text) to service_role;

-- Shared insert logic.
create or replace function public._insert_score(p_player_id bigint, p_logged_by bigint, p_machine_id int, p_value bigint, p_photo_path text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_top bigint;
begin
  if (select status from public.party where id = 1) <> 'open' then
    raise exception 'The party is closed, so scores are locked.';
  end if;
  if not exists (select 1 from public.players where id = p_player_id) then raise exception 'Unknown player.'; end if;
  if not exists (select 1 from public.machines where id = p_machine_id and active) then raise exception 'Unknown machine.'; end if;
  if p_value is null or p_value < 0 or p_value > 99999999999 then raise exception 'That score looks off.'; end if;
  if p_photo_path is not null and p_photo_path !~ '^photos/[0-9a-f-]{36}\.jpg$' then p_photo_path := null; end if;

  select id into v_id from public.scores
  where player_id = p_player_id and machine_id = p_machine_id and value = p_value and not voided
    and created_at > now() - interval '60 seconds'
  limit 1;
  if v_id is not null then return json_build_object('score_id', v_id, 'duplicate', true); end if;

  select max(value) into v_top from public.scores where machine_id = p_machine_id and not voided;
  insert into public.scores (player_id, machine_id, value, logged_by, photo_path, needs_review)
  values (p_player_id, p_machine_id, p_value, nullif(p_logged_by, p_player_id), p_photo_path,
          -- a new #1 with no photo, or logged for someone else, gets a second look from the host
          (p_photo_path is null and p_value > coalesce(v_top, -1) and v_top is not null) or (p_logged_by <> p_player_id and p_photo_path is null))
  returning id into v_id;
  return json_build_object('score_id', v_id);
end $$;
revoke all on function public._insert_score(bigint, bigint, int, bigint, text) from public, anon, authenticated;

drop function if exists public.submit_score(text, int, bigint);
create or replace function public.submit_score(p_token text, p_machine_id int, p_value bigint, p_photo_path text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token);
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  return public._insert_score(v_pid, v_pid, p_machine_id, p_value, p_photo_path);
end $$;

create or replace function public.submit_score_for(p_token text, p_player_id bigint, p_machine_id int, p_value bigint, p_photo_path text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token);
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  return public._insert_score(p_player_id, v_pid, p_machine_id, p_value, p_photo_path);
end $$;

-- Undo: your own scores, or ones you logged for a friend, within 15 minutes.
create or replace function public.undo_score(p_token text, p_score_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token);
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  update public.scores set voided = true
  where id = p_score_id and (player_id = v_pid or logged_by = v_pid) and created_at > now() - interval '15 minutes';
  if not found then raise exception 'Only your own scores from the last 15 minutes can be undone.'; end if;
  return json_build_object('ok', true);
end $$;

-- Host: mark a flagged score as reviewed.
create or replace function public.host_review(p_pass text, p_score_id bigint)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.scores set needs_review = false where id = p_score_id;
end $$;

-- Wipe also clears the photo rate-limit log.
create or replace function public.host_wipe(p_pass text, p_confirm text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  if p_confirm <> 'WIPE' then raise exception 'Type WIPE to confirm.'; end if;
  delete from public.scores where true;
  delete from public.photo_reads where true;
  delete from public.players where true;
  update public.party set status = 'open', reveal_active = false, match_digits = null, updated_at = now() where id = 1;
end $$;

grant execute on function
  public.submit_score(text, int, bigint, text),
  public.submit_score_for(text, bigint, int, bigint, text),
  public.undo_score(text, bigint),
  public.host_review(text, bigint)
to anon, authenticated;
grant select on public.machines to service_role;
