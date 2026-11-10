import { describe, it, expect } from 'vitest';
import { computeStandings, computeAwards } from '../lib/scoring.js';
import { revealPlan, FINALE_STEP } from './Reveal.jsx';
import { makeSnapshot, fromSnapshot, planChanges, summarizeAwards } from '../lib/awardsSnapshot.js';

const MACHINES = [
  [2, 'Fathom'], [1, 'Centaur'], [3, 'Whirlwind'], [4, 'Whitewater'], [5, 'Cactus Canyon'], [6, 'Dungeons & Dragons'],
].map(([id, name], i) => ({ id, name, manufacturer: 'Bally', year: 1990, sort_order: i + 1, active: true }));
const PRIZES = ['GRAND CHAMPION', '2ND PLACE', '3RD PLACE', ...MACHINES.map(m => `${m.name.toUpperCase()} CHAMPION`), 'THE GRINDER', 'THE BIG WHIFF', 'THE MATCH'];
const ORDER = ['AWARDS CEREMONY', ...PRIZES, 'THANK YOU'];

function party(nPlayers, opts = {}) {
  const { standings, awards } = partyData(nPlayers, opts);
  return revealPlan({ standings, awards });
}
function partyData(nPlayers, { machinesEach = 3, matchDigits = null, extra = [] } = {}) {
  const players = Array.from({ length: nPlayers }, (_, i) => ({ id: i + 1, display_name: `P${i + 1}`, color: '#ff00aa', emoji: '🎯' }));
  const scores = [];
  let id = 1;
  for (const p of players) {
    for (let k = 0; k < machinesEach; k++) {
      const m = MACHINES[(p.id + k) % MACHINES.length];
      scores.push({ id: id++, player_id: p.id, machine_id: m.id, value: 1000 * ((p.id * 7919 + k * 104729) % 9973) + p.id, voided: false });
    }
  }
  scores.push(...extra.map(x => ({ id: id++, voided: false, ...x })));
  const standings = computeStandings({ machines: MACHINES, players, scores });
  const awards = computeAwards({ machines: MACHINES, players, scores, standings, matchDigits });
  return { players, scores, standings, awards };
}
const prizesOf = plan => plan.filter(s => s.kind === 'prize');

describe('winner reveal', () => {
  it('always has all 12 prizes, in order, even with only 6 players', () => {
    const plan = party(6);
    expect(plan.map(s => s.label)).toEqual(ORDER);
    expect(prizesOf(plan).filter(s => s.title !== 'No winner tonight').length).toBe(6); // one prize each
  });
  it('with a full party and a drawn number, every prize has a winner', () => {
    const plan = party(40, { matchDigits: 42 });
    expect(plan.map(s => s.label)).toEqual(ORDER);
    for (const s of prizesOf(plan)) expect(s.title).not.toBe('No winner tonight');
    expect(new Set(prizesOf(plan).map(s => s.winner)).size).toBe(12); // nobody wins twice
  });
  it('with no number drawn, The Match still has its slide', () => {
    const plan = party(40);
    expect(plan[12]).toMatchObject({ label: 'THE MATCH', title: 'No winner tonight' });
    expect(plan.length).toBe(14);
  });
  it('with nobody playing, the reveal still walks all 12 prizes', () => {
    expect(party(0).map(s => s.label)).toEqual(ORDER);
  });
  it('each walk stops on the winner, and everyone above already won an earlier prize', () => {
    for (const plan of [party(40, { matchDigits: 40 }), party(6), party(13, { machinesEach: 2 })]) {
      const seen = new Set();
      for (const s of plan) {
        if (s.walk && s.label !== 'GRAND CHAMPION') {
          if (s.title !== 'No winner tonight') expect(s.walk.stopsOn).toBe(s.title);
          // Everyone the walk passes already won an earlier prize, or (podium) needs more machines.
          for (const w of s.walk.above) { expect(w).toBeTruthy(); expect(seen.has(w) || w === '__needs').toBe(true); }
        }
        if (s.title !== 'No winner tonight') seen.add(s.label);
      }
    }
  });
  it('Grand Champion has no walk; 2nd and 3rd do', () => {
    const plan = party(40, { matchDigits: 40 });
    expect(plan[1].walk).toBeFalsy();
    expect(plan[2].walk.stopsOn).toBe(plan[2].title);
    expect(plan[3].walk.above.length).toBe(2);
  });
  it('step 0 is the held intro and the last step the finale (reveal_step indexing)', () => {
    const plan = party(40, { matchDigits: 40 });
    expect(plan[0]).toMatchObject({ kind: 'intro', label: 'AWARDS CEREMONY', winner: null });
    expect(plan[FINALE_STEP]).toMatchObject({ kind: 'finale', winner: null });
    expect(plan.length).toBe(FINALE_STEP + 1);
    expect(plan.slice(1, FINALE_STEP).every(s => s.kind === 'prize')).toBe(true);
  });
  it('a 2-machine player above a podium winner is stamped NEEDS 3 MACHINES, not silently skipped', () => {
    // Player 99 tops two machines but plays only two: highest rating, no podium.
    const extra = [{ player_id: 99, machine_id: 2, value: 99_999_999 }, { player_id: 99, machine_id: 1, value: 99_999_999 }];
    const d = partyData(12, { matchDigits: 40, extra });
    d.players.push({ id: 99, display_name: 'Shorty', color: '#fff', emoji: '🎯' });
    const standings = computeStandings({ machines: MACHINES, players: d.players, scores: d.scores });
    const awards = computeAwards({ machines: MACHINES, players: d.players, scores: d.scores, standings, matchDigits: 40 });
    expect(standings.ranked[0].player.id).toBe(99);
    const plan = revealPlan({ standings, awards });
    expect(plan[1].winner).not.toBe('Shorty');
    expect(plan[1].walk.above[0]).toBe('__needs'); // Grand Champion walks to explain the skip
    // Shorty wins a machine (they top Fathom), so later walks show "WON …" for them instead.
    expect(plan.some(s => s.winner === 'Shorty')).toBe(true);
  });
  it('the finale lists every prize winner', () => {
    const { standings, awards } = partyData(40, { matchDigits: 40 });
    const plan = revealPlan({ standings, awards });
    expect(plan[FINALE_STEP].kind).toBe('finale');
    expect(plan[FINALE_STEP].winners).toEqual(prizesOf(plan).map(s => s.winner));
    expect(plan[FINALE_STEP].winners).toHaveLength(12);
  });
});

describe('awards snapshot', () => {
  it('rebuilds the same reveal from the frozen scores, whatever happens to the live ones', () => {
    const { players, scores, standings, awards } = partyData(30, { matchDigits: 70 });
    const snap = makeSnapshot({ eventId: 1, machines: MACHINES, players, scores, matchDigits: 70 });
    expect(snap.scores.length).toBe(scores.length);
    expect(snap.awards).toEqual(summarizeAwards(awards));
    const json = JSON.parse(JSON.stringify(snap)); // what the database hands back
    const frozen = fromSnapshot(json, { allMachines: MACHINES, allPlayers: players, liveScores: scores });
    const a = revealPlan({ standings, awards }), b = revealPlan(frozen);
    expect(b.map(s => s.winner)).toEqual(a.map(s => s.winner));
    expect(planChanges(a, b)).toEqual([]);
    // A huge late score changes the live result but not the snapshot.
    const late = [...scores, { id: 9999, player_id: 30, machine_id: 2, value: 9_999_999_999, voided: false }];
    const ls = computeStandings({ machines: MACHINES, players, scores: late });
    const live = revealPlan({ standings: ls, awards: computeAwards({ machines: MACHINES, players, scores: late, standings: ls, matchDigits: 70 }) });
    const again = revealPlan(fromSnapshot(json, { allMachines: MACHINES, allPlayers: players, liveScores: late }));
    expect(again.map(s => s.winner)).toEqual(a.map(s => s.winner));
    expect(planChanges(again, live).length).toBeGreaterThan(0);
  });
  it('skips free-play and removed scores, and keeps a removed player as a placeholder', () => {
    const { players, scores } = partyData(8, { matchDigits: 10 });
    const mixed = [...scores, { id: 5000, player_id: 1, machine_id: 2, value: 1e10, voided: false, free_play: true }, { id: 5001, player_id: 2, machine_id: 2, value: 1e10, voided: true }];
    const snap = makeSnapshot({ eventId: 1, machines: MACHINES, players, scores: mixed, matchDigits: 10 });
    expect(snap.scores.some(r => r[0] === 5000 || r[0] === 5001)).toBe(false);
    const frozen = fromSnapshot(snap, { allMachines: MACHINES, allPlayers: players.filter(p => p.id !== 3) });
    expect(frozen.players.find(p => p.id === 3).display_name).toBe('Removed player');
    expect(fromSnapshot({ v: 99 }, {})).toBeNull();
  });
});

describe('tv heartbeat', () => {
  it('flags a TV not seen for 20 s and names the step it shows', async () => {
    const { tvStatus, tvStatusText, stepName, agoText } = await import('../lib/tvStatus.js');
    const now = Date.parse('2026-11-14T22:00:00Z');
    const at = ms => new Date(now - ms).toISOString();
    expect(tvStatusText(tvStatus({ seen_at: at(3000), step: 3, mode: 'reveal' }, now, 3))).toBe('TV: prize 3 ✓');
    expect(tvStatusText(tvStatus({ seen_at: at(3000), step: 0, mode: 'reveal' }, now, 0))).toBe('TV: intro ✓');
    expect(tvStatusText(tvStatus({ seen_at: at(3000), step: 13, mode: 'reveal' }, now, 13))).toBe('TV: finale ✓');
    expect(tvStatusText(tvStatus({ seen_at: at(3000), step: 2, mode: 'reveal' }, now, 3))).toBe('TV: prize 2 (catching up…)');
    expect(tvStatusText(tvStatus({ seen_at: at(21000), step: 3, mode: 'reveal' }, now, 3))).toBe('TV not seen for 21 s');
    expect(tvStatusText(tvStatus({ seen_at: at(19000), step: 3, mode: 'reveal' }, now, 3))).toBe('TV: prize 3 ✓');
    expect(tvStatus(null, now).never).toBe(true);
    expect(tvStatusText(tvStatus({ seen_at: at(1000), step: 0, mode: 'board' }, now, 2))).toMatch(/not showing the reveal/);
    expect(stepName(12)).toBe('prize 12');
    expect(agoText(125000)).toBe('2 min');
  });
});
