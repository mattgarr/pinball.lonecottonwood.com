// Host: email each opted-in player their final results for an event.
// Standings are computed here (same math as the app); the edge function looks up the private
// email addresses, renders and sends via Resend, then stamps events.results_sent_at.
import { SUPABASE_URL, SUPABASE_KEY, getHostPass, getState } from './store.js';
import { computeStandings, computeAwards, ordinal, prizesFor } from './scoring.js';

// testTo: send one sample (the top player's results) to that address only; nothing is stamped as sent.
export async function emailResults(eventId, { testTo } = {}) {
  const s = getState();
  const event = s.events.find(e => e.id === eventId);
  const mids = new Set(s.eventMachines.filter(x => x.event_id === eventId).map(x => x.machine_id));
  // Same as the TV: an event with no machines attached uses all of them.
  const machines = mids.size ? s.allMachines.filter(m => mids.has(m.id)) : s.allMachines;
  const isCurrent = eventId === s.party?.current_event_id;
  // Tournament games only: free play never shows up in results.
  const scores = s.allScores.filter(x => (x.event_id === eventId || (isCurrent && x.event_id == null)) && !x.free_play);
  const entrants = new Set(s.entries.filter(x => x.event_id === eventId).map(x => x.player_id));
  for (const x of scores) entrants.add(x.player_id);
  const players = s.players.filter(p => entrants.has(p.id));
  const standings = computeStandings({ machines, players, scores });
  const awards = computeAwards({ machines, players, scores, standings, matchDigits: event?.match_digits ?? null });


  const byMachine = new Map();
  for (const x of scores) if (!x.voided) { if (!byMachine.has(x.machine_id)) byMachine.set(x.machine_id, []); byMachine.get(x.machine_id).push(x); }
  const results = players.map(p => {
    const st = standings.stats.get(p.id);
    return {
      player_id: p.id,
      name: p.display_name,
      rank: st?.rank ? ordinal(st.rank) : null,
      ranked_of: standings.ranked.length,
      rating: st?.rating ?? null,
      games: st?.plays ?? 0,
      machines: machines.map(m => {
        const pm = st?.perMachine[m.id];
        // Every game this player logged here, each ranked against ALL games on this machine tonight.
        const all = byMachine.get(m.id) || [];
        const played = all.filter(x => x.player_id === p.id).map(x => ({
          value: x.value, at: x.created_at, rank: 1 + all.filter(y => y.value > x.value).length, of: all.length,
        })).sort((a, b) => b.value - a.value);
        return { name: m.name, best: pm?.best ?? null, rank: pm ? `${ordinal(pm.rank)} of ${pm.N}` : null, played };
      }),
      prizes: prizesFor(awards, p.id),
    };
  }).filter(x => x.games > 0) // only people who actually played (no results to sign-ups that never logged a game)
    .sort((a, b) => (a.rank ? parseInt(a.rank) : 1e9) - (b.rank ? parseInt(b.rank) : 1e9));
  const board = standings.ranked.slice(0, 10).map(st => ({ rank: st.rank, name: st.player.display_name, rating: st.rating }));

  const r = await fetch(`${SUPABASE_URL}/functions/v1/email-results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify({ pass: getHostPass(), event_id: eventId, event_name: event?.name, event_date: event?.starts_on, results, board, test_to: testTo || undefined,
      stats: { players: players.length, games: scores.filter(x => !x.voided).length, machines: machines.length } }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || "Couldn't send the emails.");
  return out; // { sent, skipped }
}
