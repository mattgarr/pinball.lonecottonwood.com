-- Tickets: the host marks which invited guests have paid. Paid guests get the "you're in"
-- registration email (QR + link); unpaid guests get the invite with a "get tickets" link.
-- events.ticket_url = where to buy. Host can also copy any guest's personal join link (token).
-- Safe to run more than once.

alter table public.events add column if not exists ticket_url text check (ticket_url is null or ticket_url ~* '^https?://');
alter table public.event_invites add column if not exists paid boolean not null default false;
alter table public.event_invites add column if not exists register_sent_at timestamptz;

drop function if exists public.host_add_invites(text, int, text);
create or replace function public.host_add_invites(p_pass text, p_event_id int, p_lines text, p_paid boolean default false)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_line text; v_email text; v_name text; v_n int := 0;
begin
  perform public._require_host(p_pass);
  if not exists (select 1 from public.events where id = p_event_id) then raise exception 'Event not found.'; end if;
  foreach v_line in array regexp_split_to_array(coalesce(p_lines, ''), E'[\\n;]+') loop
    v_email := lower(substring(v_line from '[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+'));
    continue when v_email is null;
    v_name := nullif(btrim(regexp_replace(replace(v_line, v_email, ''), '[<>,"]', '', 'g')), '');
    v_name := nullif(btrim(regexp_replace(coalesce(v_name, ''), '\S+@\S+', '', 'g')), '');
    insert into public.event_invites (event_id, email, name, paid) values (p_event_id, v_email, left(v_name, 60), coalesce(p_paid, false))
    on conflict (event_id, email) do update set name = coalesce(excluded.name, event_invites.name),
      paid = event_invites.paid or excluded.paid;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.host_invites(p_pass text, p_event_id int)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  return coalesce((
    select json_agg(json_build_object('id', i.id, 'email', i.email, 'name', i.name, 'invited_at', i.invited_at,
                                      'paid', i.paid, 'register_sent_at', i.register_sent_at, 'token', i.token,
                                      'player_id', i.player_id, 'player_name', p.display_name) order by i.created_at)
    from public.event_invites i left join public.players p on p.id = i.player_id
    where i.event_id = p_event_id), '[]'::json);
end $$;

create or replace function public.host_set_invite_paid(p_pass text, p_invite_id bigint, p_paid boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.event_invites set paid = coalesce(p_paid, false) where id = p_invite_id;
end $$;

create or replace function public.host_set_ticket_url(p_pass text, p_event_id int, p_url text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.events set ticket_url = nullif(btrim(coalesce(p_url, '')), '') where id = p_event_id;
end $$;

grant update (register_sent_at, invited_at) on public.event_invites to service_role;
grant execute on function
  public.host_add_invites(text, int, text, boolean),
  public.host_set_invite_paid(text, bigint, boolean),
  public.host_set_ticket_url(text, int, text)
to anon, authenticated;
