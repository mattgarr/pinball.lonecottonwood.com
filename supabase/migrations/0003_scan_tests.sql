-- Scanner test & calibration: per-machine scan method, and a log of host test captures.

alter table public.machines
  add column if not exists scan_mode text not null default 'frames',
  add column if not exists scan_fps  int  not null default 4;

create table if not exists public.scan_tests (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  machine_id  int not null references public.machines(id),
  method      text not null,          -- frames | video
  fps         int,
  conditions  text,                   -- free tags, e.g. "lights off, glare"
  truth       jsonb,                  -- [{slot, value}] as confirmed by the tester
  result      jsonb,                  -- what the reader returned
  correct     boolean,
  ms          int,                    -- end-to-end time seen on the phone
  photo_path  text
);
alter table public.scan_tests enable row level security;

create or replace function public.host_log_scan_test(
  p_pass text, p_machine_id int, p_method text, p_fps int, p_conditions text,
  p_truth jsonb, p_result jsonb, p_correct boolean, p_ms int, p_photo_path text)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint;
begin
  perform public._require_host(p_pass);
  insert into public.scan_tests (machine_id, method, fps, conditions, truth, result, correct, ms, photo_path)
  values (p_machine_id, p_method, p_fps, p_conditions, p_truth, p_result, p_correct, p_ms, p_photo_path)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.host_scan_tests(p_pass text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  return coalesce((select json_agg(t order by t.id) from public.scan_tests t), '[]'::json);
end $$;

create or replace function public.host_set_scan_mode(p_pass text, p_machine_id int, p_mode text, p_fps int)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  if p_mode not in ('frames', 'video') then raise exception 'Unknown scan mode.'; end if;
  update public.machines set scan_mode = p_mode, scan_fps = greatest(1, least(15, coalesce(p_fps, 4))) where id = p_machine_id;
end $$;

grant execute on function
  public.host_log_scan_test(text, int, text, int, text, jsonb, jsonb, boolean, int, text),
  public.host_scan_tests(text),
  public.host_set_scan_mode(text, int, text, int)
to anon, authenticated;
