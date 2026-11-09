-- Let the Join screen draw the 8-bit portrait before the player exists (no token yet).
-- Capped at 200 portraits per hour for the whole party so nobody can run up the Gemini bill.
create table if not exists public.avatar_calls (id bigserial primary key, at timestamptz not null default now());
alter table public.avatar_calls enable row level security;
grant all on public.avatar_calls to service_role;
grant usage, select on sequence public.avatar_calls_id_seq to service_role;

create or replace function public.avatar_gate_anon()
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.avatar_calls where at > now() - interval '1 hour') >= 200 then
    raise exception 'Too many selfies right now. Try again in a bit.';
  end if;
  insert into public.avatar_calls default values;
end $$;

revoke all on function public.avatar_gate_anon() from public, anon, authenticated;
grant execute on function public.avatar_gate_anon() to service_role;
