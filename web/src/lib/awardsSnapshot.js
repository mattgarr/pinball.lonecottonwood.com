// Awards snapshot (Nov 10): at "Start the reveal" the host page freezes the tournament as it stands
// (every counting score, who's in the event, the machines and the Match draw) and saves it on the event
// (award_snapshots, migration 0040). During and after the reveal the TV, the host's plan and the results
// email all compute from the frozen copy, so a late score, an undo or a host fix can't change a prize
// that's already on screen. Names and portraits still come from the live players list. "Recompute
// prizes" on the host page saves a fresh snapshot on purpose.
import { computeAwards, computeStandings } from './scoring.js';

export const SNAP_VERSION = 1;

// The counting scores of an event (not removed, not free play).
const counting = scores => scores.filter(s => !s.voided && !s.free_play);

// machines: the event's machines in board order; players: the event's players; scores: the event's scores.
export function makeSnapshot({ eventId = null, machines = [], players = [], scores = [], matchDigits = null, now = new Date() }) {
  const live = counting(scores);
  const standings = computeStandings({ machines, players, scores: live });
  const awards = computeAwards({ machines, players, scores: live, standings, matchDigits });
  return {
    v: SNAP_VERSION,
    event_id: eventId,
    saved_at: now.toISOString(),
    match_digits: matchDigits ?? null,
    machines: machines.map(m => m.id),
    players: players.map(p => p.id),
    scores: live.map(s => [s.id, s.player_id, s.machine_id, Number(s.value)]),
    awards: summarizeAwards(awards),
  };
}

// The prizes as plain ids and values (what was decided), kept with the snapshot for the record.
export function summarizeAwards(a = {}) {
  const pid = x => x?.player?.id ?? null;
  return {
    champion: a.champion ? { player: pid(a.champion), rating: a.champion.rating, exact: a.champion.exact } : null,
    second: a.second ? { player: pid(a.second), rating: a.second.rating, exact: a.second.exact } : null,
    third: a.third ? { player: pid(a.third), rating: a.third.rating, exact: a.third.exact } : null,
    machines: (a.machineChamps ?? []).map(c => ({ machine: c.machine?.id ?? null, player: pid(c), score: c.score ?? null })),
    grinder: a.grinder ? { player: pid(a.grinder), plays: a.grinder.plays } : null,
    bigWhiff: a.bigWhiff ? { player: pid(a.bigWhiff), rating: a.bigWhiff.rating } : null,
    match: a.theMatch
      ? { player: pid(a.theMatch), drawn: a.theMatch.drawn, value: a.theMatch.value, exact: a.theMatch.exact,
          tied: (a.theMatch.tied ?? []).map(p => p.id), pool: (a.theMatch.pool ?? []).map(p => p.id) }
      : null,
    matchDrawn: !!a.matchDrawn,
  };
}

const placeholder = id => ({ id, display_name: 'Removed player', emoji: '❔', color: '#888888', avatar: null });

// Rebuild standings + awards from a snapshot. allMachines / allPlayers: the live lists (for names,
// portraits and machine details). liveScores (optional): the live rows, to keep each frozen score's time.
export function fromSnapshot(snap, { allMachines = [], allPlayers = [], liveScores = [] } = {}) {
  if (!snap || snap.v !== SNAP_VERSION || !Array.isArray(snap.scores)) return null;
  const mById = new Map(allMachines.map(m => [m.id, m]));
  const pById = new Map(allPlayers.map(p => [p.id, p]));
  const tById = new Map(liveScores.map(s => [s.id, s.created_at]));
  const machines = (snap.machines ?? []).map(id => mById.get(id)).filter(Boolean);
  const players = (snap.players ?? []).map(id => pById.get(id) || placeholder(id));
  const scores = snap.scores.map(([id, player_id, machine_id, value]) => ({
    id, player_id, machine_id, value, voided: false, free_play: false, created_at: tById.get(id) ?? null,
  }));
  const standings = computeStandings({ machines, players, scores });
  const awards = computeAwards({ machines, players, scores, standings, matchDigits: snap.match_digits });
  return { machines, players, scores, standings, awards, savedAt: snap.saved_at, matchDigits: snap.match_digits };
}

// Steps whose winner differs between two reveal plans (e.g. the saved prizes vs the live scores).
export function planChanges(saved = [], live = []) {
  const out = [];
  for (let i = 0; i < Math.max(saved.length, live.length); i++) {
    const a = saved[i], b = live[i];
    if (!a || !b || a.kind !== 'prize') continue;
    if ((a.playerId ?? null) !== (b.playerId ?? null)) out.push({ step: i, label: a.label, saved: a.winner, live: b.winner });
  }
  return out;
}
