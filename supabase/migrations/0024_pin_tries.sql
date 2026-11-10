-- Rejoin: 10 wrong PINs (was 5) before a 2-minute lock, and say how many tries are left near the end.
create or replace function public.rejoin(p_player_id bigint, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v public.player_pins%rowtype; v_left int;
begin
  select * into v from public.player_pins where player_id = p_player_id;
  if not found then return json_build_object('error', 'Player not found.'); end if;
  if v.locked_until is not null and v.locked_until > now() then
    return json_build_object('error', 'Too many tries. Wait 2 minutes, or ask the host to reset your PIN.');
  end if;
  if v.pin_hash <> crypt(coalesce(p_pin, ''), v.pin_hash) then
    v_left := 10 - (v.failed_attempts + 1);
    if v_left <= 0 then
      update public.player_pins set failed_attempts = 0, locked_until = now() + interval '2 minutes'
      where player_id = p_player_id;
      return json_build_object('error', 'Too many tries. Wait 2 minutes, or ask the host to reset your PIN.');
    end if;
    update public.player_pins set failed_attempts = failed_attempts + 1 where player_id = p_player_id;
    return json_build_object('error', case when v_left = 1 then 'Wrong PIN. 1 try left.' when v_left <= 3 then format('Wrong PIN. %s tries left.', v_left) else 'Wrong PIN.' end);
  end if;
  update public.player_pins set failed_attempts = 0, locked_until = null where player_id = p_player_id;
  perform public._enter_event(p_player_id);
  return json_build_object('player_id', p_player_id, 'token', public._new_token(p_player_id));
end $$;
