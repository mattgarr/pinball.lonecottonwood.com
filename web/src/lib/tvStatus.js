// TV heartbeat (Nov 10): the TV reports the reveal step it's showing (tv_heartbeat RPC → tv_status row,
// migration 0040) every 10 s and right after a step change; the host page reads it every few seconds
// while the reveal is on and shows "TV: prize 3 ✓" or "TV not seen for 20 s".
// Why an RPC and not MQTT: it works whether or not the garage lights are set up on this Mac, and it's
// one tiny row update every 10 s on a table phones never subscribe to, so it adds no fan-out.
export const TV_BEAT_MS = 10_000;
export const TV_STALE_MS = 20_000;
export const OFFLINE_MS = 60_000;

// row: { seen_at, step, mode } from tv_status; nowMs: the server-synced clock.
export function tvStatus(row, nowMs, partyStep = null) {
  if (!row?.seen_at) return { ok: false, never: true, ago: null, step: null, mode: null, behind: false };
  const ago = Math.max(0, nowMs - Date.parse(row.seen_at));
  const ok = ago < TV_STALE_MS;
  return { ok, never: false, ago, step: row.step ?? null, mode: row.mode || null, behind: ok && partyStep != null && row.mode === 'reveal' && row.step !== partyStep };
}

// What the reveal step is called on the host page: 0 intro, 1–12 "prize N", 13 finale.
export function stepName(step, prizes = 12) {
  if (step == null) return '?';
  if (step <= 0) return 'intro';
  if (step > prizes) return 'finale';
  return `prize ${step}`;
}

export function tvStatusText(st, prizes = 12) {
  if (st.never) return 'TV not seen yet: is /tv open on the TV?';
  if (!st.ok) return `TV not seen for ${agoText(st.ago)}`;
  if (st.mode !== 'reveal') return 'TV is on, but not showing the reveal yet (reload /tv)';
  return `TV: ${stepName(st.step, prizes)}${st.behind ? ' (catching up…)' : ' ✓'}`;
}

// "45 s", "2 min", "1 h".
export function agoText(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}
