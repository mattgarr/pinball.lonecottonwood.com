// Tournament schedule, free play and the countdowns. Pure functions (tested in schedule.test.js).
//
// The database decides whether a score counts (scores.free_play, set at insert time from its own
// clock). Everything here is only for showing it: which board the TV shows, the countdown chip,
// and the minute-mark takeovers.

export const TZ = 'America/Los_Angeles';
export const START_MARKS = [5, 4, 3, 2, 1];          // minutes before the start
export const END_MARKS = [15, 10, 5, 4, 3, 2, 1];    // minutes before the end
export const FINAL_SECONDS = 10;                     // full-screen 10…1 before the end
export const GRACE_MS = 30000;                       // a mark fires only within 30 s of its time (no backlog)
export const LOG_GRACE_MS = 3 * 60000;               // scores logged up to 3 min after the end still count (same as the database)
export const SEAL_MS = 15 * 60000;                   // results are sealed from 15 min before the end until the reveal

const ts = v => (v ? Date.parse(v) || null : null);

// A score counts for the tournament unless it's voided or free play.
export const counts = s => !s.voided && !s.free_play;

// What's happening right now:
//   'pre'    before the scheduled start (free play)
//   'on'     the tournament is running
//   'closed' scores stopped by hand (no schedule, or stopped early)
//   'grace'  play is over, but scores logged now still count (3 minutes to snap the last game)
//   'over'   past the end + grace, before the host starts free play (logging is free play)
//   'reveal' the winners reveal is on the TV
//   'free'   free play after the awards
export function tourneyPhase(party, now) {
  if (!party) return 'on';
  if (party.reveal_active) return 'reveal';
  if (party.free_play) return 'free';
  const s = ts(party.tourney_starts_at), e = ts(party.tourney_ends_at);
  if (s && now < s) return 'pre';
  if (e && now >= e + LOG_GRACE_MS) return 'over';
  if (e && now >= e) return 'grace';
  if (party.status === 'closed') return 'closed';
  return 'on';
}

// When the phase will next change by the clock alone (ms epoch), or null.
export function nextBoundary(party, now) {
  if (!party || party.reveal_active || party.free_play) return null;
  const e = ts(party.tourney_ends_at);
  const out = [ts(party.tourney_starts_at), e && e - SEAL_MS, e, e && e + LOG_GRACE_MS].filter(t => t && t > now);
  return out.length ? Math.min(...out) : null;
}

// Logging a score now: does it count? (Mirrors the database rule; the database has the last word.)
export const scoreCountsNow = (party, now) => ['on', 'grace'].includes(tourneyPhase(party, now));

// Has this tournament's reveal happened (started after the seal began)? An old test reveal doesn't count.
export function revealedAfterEnd(party) {
  const e = ts(party?.tourney_ends_at), r = ts(party?.revealed_at);
  return !!(e && r && r >= e - SEAL_MS);
}

// Results sealed: from 15 min before the end until the reveal starts (the TV, Ranks and Me hide who's
// on the podium so the awards are a surprise).
export function sealed(party, now) {
  const e = ts(party?.tourney_ends_at);
  if (!e || party.reveal_active || party.free_play || revealedAfterEnd(party)) return false;
  return now >= e - SEAL_MS;
}

// The countdown chip: { label, ms } or null.
export function countdown(party, now) {
  const p = tourneyPhase(party, now);
  if (p === 'pre') return { kind: 'start', label: 'Tournament starts in', ms: ts(party.tourney_starts_at) - now };
  if (p === 'on' && ts(party.tourney_ends_at)) return { kind: 'end', label: 'Tournament ends in', ms: ts(party.tourney_ends_at) - now };
  if (p === 'grace') return { kind: 'log', label: 'Log your last scores', ms: ts(party.tourney_ends_at) + LOG_GRACE_MS - now };
  return null;
}

// Seconds left in the final 10-second countdown, or 0 when not in it.
export function finalSeconds(party, now) {
  const e = ts(party?.tourney_ends_at);
  if (!e || party.reveal_active || party.free_play || party.status === 'closed') return 0;
  const left = e - now;
  return left > 0 && left <= FINAL_SECONDS * 1000 ? Math.ceil(left / 1000) : 0;
}

// The minute-mark / start / end takeover due right now, or null. `fired` is the set of keys already
// shown (kept across reloads), so each fires once; a mark more than GRACE_MS late never fires, so a
// TV that slept or reloaded doesn't play a backlog.
export function dueClockMoment(party, now, fired = new Set()) {
  if (!party || party.reveal_active || party.free_play) return null;
  const s = ts(party.tourney_starts_at), e = ts(party.tourney_ends_at);
  const check = (kind, target, marks) => {
    if (!target) return null;
    const left = target - now;
    for (const m of [...marks, 0]) {
      const at = m * 60000;
      // The end's last minute plays as the 10…1 countdown, then the 0 card.
      if (left <= at && left > at - GRACE_MS) {
        const key = `${kind}:${target}:${m}`;
        if (!fired.has(key)) return { key, kind, minutes: m, target };
      }
    }
    return null;
  };
  // The start doesn't fire once the end has passed (e.g. both times set in the past).
  return (e && now >= e + GRACE_MS ? null : check('start', s, START_MARKS)) || check('end', e, END_MARKS);
}

// Server clock offset from one round trip: the server's time is taken as the midpoint.
export function clockOffset(sentAt, receivedAt, serverIso) {
  const server = Date.parse(serverIso);
  if (!Number.isFinite(server)) return null;
  return Math.round(server - (sentAt + receivedAt) / 2);
}

// Best of several samples: the one with the shortest round trip.
export function bestOffset(samples) {
  const ok = samples.filter(x => x && x.offset != null).sort((a, b) => a.rtt - b.rtt);
  return ok.length ? ok[0].offset : null;
}

export function fmtCountdown(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ---- Pacific time helpers (the party is in Woodside, whatever the device's time zone) ----
function partsIn(date, tz = TZ) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = Object.fromEntries(f.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  return o;
}
const tzOffset = (ms, tz) => {
  const p = partsIn(new Date(ms), tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};

// '2026-11-14T19:30' (Pacific wall clock) → ISO string, or null.
export function pacificToIso(local, tz = TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || '');
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = guess - tzOffset(guess, tz);
  const off2 = tzOffset(t, tz);
  if (guess - off2 !== t) t = guess - off2;
  return new Date(t).toISOString();
}

// ISO → '2026-11-14T19:30' in Pacific time (for <input type="datetime-local">).
export function isoToPacific(iso, tz = TZ) {
  if (!iso) return '';
  const p = partsIn(new Date(iso), tz);
  const pad = n => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// '7:30 PM' in Pacific time.
export const fmtClock = (iso, tz = TZ) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }) : '');
