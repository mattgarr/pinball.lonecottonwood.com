-- Safer pre-party cleanup + accurate "emailed" tracking. Safe to run more than once.
-- 1. host_clear_scores: deletes scores only (keeps players, guest list, emails). The full wipe stays for emergencies.
-- 2. event_invites.update_sent_at: when the guest last got an "update" email (updates no longer touch invited_at).

alter table public.event_invites add column if not exists update_sent_at timestamptz;

create or replace function public.host_clear_scores(p_pass text, p_confirm text)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_n int;
begin
  perform public._require_host(p_pass);
  if p_confirm <> 'CLEAR' then raise exception 'Type CLEAR to confirm.'; end if;
  select count(*) into v_n from public.scores;
  delete from public.scores where true;
  delete from public.photo_reads where true;
  update public.events set reveal_active = false, match_digits = null, results_sent_at = null where true;
  update public.party set reveal_active = false, match_digits = null, updated_at = now() where id = 1;
  return v_n;
end $$;

create or replace function public.host_invites(p_pass text, p_event_id int)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  return coalesce((
    select json_agg(json_build_object(
      'id', i.id, 'email', i.email, 'name', i.name, 'phone', i.phone, 'party_size', i.party_size,
      'paid', i.paid, 'rsvp', i.rsvp, 'notes', i.notes, 'token', i.token,
      'invited_at', i.invited_at, 'register_sent_at', i.register_sent_at, 'update_sent_at', i.update_sent_at,
      'created_at', i.created_at,
      'player_id', i.player_id, 'player_name', p.display_name, 'player_avatar', p.avatar, 'player_emoji', p.emoji,
      'games', (select count(*) from public.scores s where s.player_id = i.player_id and s.event_id = i.event_id and not s.voided)
    ) order by lower(coalesce(i.name, i.email)))
    from public.event_invites i left join public.players p on p.id = i.player_id
    where i.event_id = p_event_id), '[]'::json);
end $$;

grant execute on function public.host_clear_scores(text, text) to anon, authenticated;
grant update (update_sent_at) on public.event_invites to service_role;
