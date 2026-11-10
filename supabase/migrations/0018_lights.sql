-- Garage lights (Nov 9): one settings row the TV (which drives the lights) and /host share.
-- * enabled: the runtime on/off switch. Off = the TV sends nothing to the lights at all.
-- * dry_run: simulator only. Commands go to the simulator topic, never to the real controller.
-- * zones: calibrated machine zones per run, saved from /host/calibrate (null = even split).
-- Safe to run more than once.
create table if not exists public.lights_settings (
  id         int primary key default 1 check (id = 1),
  enabled    boolean not null default false,
  dry_run    boolean not null default true,
  zones      jsonb,
  updated_at timestamptz not null default now()
);
insert into public.lights_settings (id) values (1) on conflict (id) do nothing;

alter table public.lights_settings enable row level security;
drop policy if exists "public read" on public.lights_settings;
create policy "public read" on public.lights_settings for select to anon, authenticated using (true);
grant select on public.lights_settings to anon, authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.lights_settings; exception when duplicate_object then null; end;
end $$;

-- Host: change any of the settings (null = leave as is).
create or replace function public.host_set_lights(p_pass text, p_enabled boolean default null,
  p_dry_run boolean default null, p_zones jsonb default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  if p_zones is not null and jsonb_typeof(p_zones) <> 'object' then raise exception 'Bad zones.'; end if;
  update public.lights_settings set
    enabled = coalesce(p_enabled, enabled),
    dry_run = coalesce(p_dry_run, dry_run),
    zones = coalesce(p_zones, zones),
    updated_at = now()
  where id = 1;
end $$;
grant execute on function public.host_set_lights(text, boolean, boolean, jsonb) to anon, authenticated;
