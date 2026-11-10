-- Winner reveal, advanced by hand (Nov 9): the TV shows prize number `reveal_step` (0 = first) and
-- waits; the host page's Next / Back buttons (or a click on the TV Mac) move it. Starting the reveal
-- goes back to the first prize. Safe to run more than once.
alter table public.party add column if not exists reveal_step int not null default 0;

create or replace function public.host_reveal(p_pass text, p_active boolean, p_match_digits int default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.events set reveal_active = p_active,
    match_digits = case when p_active then p_match_digits else match_digits end
  where id = public._current_event();
  update public.party set reveal_active = p_active,
    match_digits = case when p_active then p_match_digits else match_digits end,
    reveal_step = case when p_active then 0 else reveal_step end,
    updated_at = now()
  where id = 1;
end $$;

create or replace function public.host_reveal_step(p_pass text, p_step int)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  update public.party set reveal_step = greatest(0, least(coalesce(p_step, 0), 99)), updated_at = now() where id = 1;
end $$;
revoke all on function public.host_reveal_step(text, int) from public;
grant execute on function public.host_reveal_step(text, int) to anon, authenticated;
