-- Garage lights: the MQTT channel name ("device topic") is a secret (Nov 9). Anyone who knows it can
-- send the controller commands, and the repo and the website are public, so it lives only here,
-- readable with the host passcode. The name is generated in the database and never written to the
-- repo. WLED allows at most 32 characters: 'wp/' + 28 hex = 31 (+ 'g' for the group topic = 32).
-- Safe to run more than once (keeps an existing name).
create table if not exists public.lights_secret (
  id int primary key default 1 check (id = 1),
  topic text not null check (length(topic) <= 31)
);
alter table public.lights_secret enable row level security;
revoke all on public.lights_secret from anon, authenticated;
insert into public.lights_secret (id, topic)
  values (1, 'wp/' || encode(extensions.gen_random_bytes(14), 'hex'))
  on conflict (id) do nothing;

create or replace function public.host_lights_topic(p_pass text)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  return (select topic from public.lights_secret where id = 1);
end $$;
revoke all on function public.host_lights_topic(text) from public;
grant execute on function public.host_lights_topic(text) to anon, authenticated;
