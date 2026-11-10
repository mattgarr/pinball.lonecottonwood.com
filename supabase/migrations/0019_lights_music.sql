-- Garage lights: music mode (Nov 9). music = name of a sound-reactive effect (see lights config), or null.
-- Safe to run more than once.
alter table public.lights_settings add column if not exists music text check (music is null or length(music) <= 40);

drop function if exists public.host_set_lights(text, boolean, boolean, jsonb);
create or replace function public.host_set_lights(p_pass text, p_enabled boolean default null,
  p_dry_run boolean default null, p_zones jsonb default null, p_music text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  if p_zones is not null and jsonb_typeof(p_zones) <> 'object' then raise exception 'Bad zones.'; end if;
  update public.lights_settings set
    enabled = coalesce(p_enabled, enabled),
    dry_run = coalesce(p_dry_run, dry_run),
    zones = coalesce(p_zones, zones),
    music = case when p_music is null then music else nullif(p_music, '') end, -- '' turns music mode off
    updated_at = now()
  where id = 1;
end $$;
grant execute on function public.host_set_lights(text, boolean, boolean, jsonb, text) to anon, authenticated;
