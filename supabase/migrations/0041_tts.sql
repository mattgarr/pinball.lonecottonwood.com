-- The AI announcer (edge function `tts`, Gemini text-to-speech).
--   tts_voices: the voice each announcer pack speaks with (a designed `voice_...` id, or a prebuilt name)
--   tts_calls:  one row per line actually generated (cache misses), for the hourly cap
--   tts_gate:   host-only, at most 1500 new lines an hour (a whole night is a few hundred)
--   storage bucket `tts`: the generated WAV files, public, named by a hash of voice + style + text,
--   so a line said twice is generated once.
create table if not exists public.tts_voices (
  pack text primary key,
  voice text not null,
  model text not null,
  style text not null default '',
  prompt text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.tts_voices enable row level security;
grant all on public.tts_voices to service_role;

create table if not exists public.tts_calls (id bigserial primary key, at timestamptz not null default now());
alter table public.tts_calls enable row level security;
grant all on public.tts_calls to service_role;
grant usage, select on sequence public.tts_calls_id_seq to service_role;

create or replace function public.tts_gate(p_pass text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.host_check(p_pass) then raise exception 'Wrong host passcode.'; end if;
  if (select count(*) from public.tts_calls where at > now() - interval '1 hour') >= 1500 then
    raise exception 'The announcer is busy. Try again in a bit.';
  end if;
  insert into public.tts_calls default values;
end $$;
revoke all on function public.tts_gate(text) from public, anon, authenticated;
grant execute on function public.tts_gate(text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tts', 'tts', true, 2000000, array['audio/wav'])
on conflict (id) do update set public = true;
