import { describe, it, expect } from 'vitest';
import { computeStandings, computeAwards } from '../lib/scoring.js';
import { revealPlan } from './Reveal.jsx';

const MACHINES = [
  [2, 'Fathom'], [1, 'Centaur'], [3, 'Whirlwind'], [4, 'Whitewater'], [5, 'Cactus Canyon'], [6, 'Dungeons & Dragons'],
].map(([id, name], i) => ({ id, name, manufacturer: 'Bally', year: 1990, sort_order: i + 1, active: true }));
const ORDER = ['GRAND CHAMPION', '2ND PLACE', '3RD PLACE', ...MACHINES.map(m => `${m.name.toUpperCase()} CHAMPION`), 'THE GRINDER', 'THE BIG WHIFF', 'THE MATCH'];

function party(nPlayers, { machinesEach = 3, matchDigits = null } = {}) {
  const players = Array.from({ length: nPlayers }, (_, i) => ({ id: i + 1, display_name: `P${i + 1}`, color: '#ff00aa', emoji: '🎯' }));
  const scores = [];
  let id = 1;
  for (const p of players) {
    for (let k = 0; k < machinesEach; k++) {
      const m = MACHINES[(p.id + k) % MACHINES.length];
      scores.push({ id: id++, player_id: p.id, machine_id: m.id, value: 1000 * ((p.id * 7919 + k * 104729) % 9973) + p.id, voided: false });
    }
  }
  const standings = computeStandings({ machines: MACHINES, players, scores });
  const awards = computeAwards({ machines: MACHINES, players, scores, standings, matchDigits });
  return revealPlan({ standings, awards });
}

describe('winner reveal', () => {
  it('always has all 12 prizes, in order, even with only 6 players', () => {
    const plan = party(6);
    expect(plan.map(s => s.label)).toEqual(ORDER);
    expect(plan.filter(s => s.title !== 'No winner tonight').length).toBe(6); // one prize each
  });
  it('with a full party and a drawn number, every prize has a winner', () => {
    const plan = party(40, { matchDigits: 42 });
    expect(plan.map(s => s.label)).toEqual(ORDER);
    for (const s of plan) expect(s.title).not.toBe('No winner tonight');
    expect(new Set(plan.map(s => s.title)).size).toBe(12); // nobody wins twice
  });
  it('with no number drawn, The Match still has its slide', () => {
    const plan = party(40);
    expect(plan[11]).toMatchObject({ label: 'THE MATCH', title: 'No winner tonight' });
    expect(plan.length).toBe(12);
  });
  it('with nobody playing, the reveal still walks all 12 prizes', () => {
    expect(party(0).map(s => s.label)).toEqual(ORDER);
  });
  it('each walk stops on the winner, and everyone above already won an earlier prize', () => {
    for (const plan of [party(40, { matchDigits: 40 }), party(6), party(13, { machinesEach: 2 })]) {
      const seen = new Set();
      for (const s of plan) {
        if (s.walk) {
          if (s.title !== 'No winner tonight') expect(s.walk.stopsOn).toBe(s.title);
          for (const w of s.walk.above) { expect(w).toBeTruthy(); expect(seen.has(w)).toBe(true); }
        }
        if (s.title !== 'No winner tonight') seen.add(s.label);
      }
    }
  });
});
