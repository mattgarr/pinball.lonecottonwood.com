-- AI 8-bit avatars: the pixel-art portrait replaces players.avatar; the original selfie is kept in players.selfie.
alter table public.players add column if not exists selfie text;
grant select on public.players to service_role;

create or replace function public.set_my_avatar(p_token text, p_avatar text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public._player_for_token(p_token);
begin
  if v_pid is null then raise exception 'Please join (or rejoin) first.'; end if;
  if coalesce(p_avatar, '') !~ '^data:image/(png|jpeg|webp);base64,' or length(p_avatar) > 300000 then raise exception 'Bad image.'; end if;
  update public.players
     set selfie = coalesce(selfie, case when avatar like 'data:image/jpeg%' then avatar end), avatar = p_avatar
   where id = v_pid;
end $$;

create or replace function public.host_set_avatar(p_pass text, p_player_id bigint, p_avatar text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require_host(p_pass);
  if coalesce(p_avatar, '') !~ '^data:image/(png|jpeg|webp);base64,' or length(p_avatar) > 300000 then raise exception 'Bad image.'; end if;
  update public.players
     set selfie = coalesce(selfie, case when avatar like 'data:image/jpeg%' then avatar end), avatar = p_avatar
   where id = p_player_id;
end $$;

grant execute on function public.set_my_avatar(text, text), public.host_set_avatar(text, bigint, text) to anon, authenticated;
