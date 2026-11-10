import { describe, it, expect } from 'vitest';
import { computeStandings, computeAwards, computeHighScores } from './scoring.js';

const M = [1, 2, 3].map(id => ({ id, name: `M${id}` }));
const P = [1, 2, 3, 4, 5].map(id => ({ id, display_name: `P${id}` }));
let sid = 1;
const sc = (player_id, machine_id, value, free_play = false) => ({ id: sid++, player_id, machine_id, value, voided: false, free_play });

describe('free play never counts for the tournament', () => {
  const tourney = [sc(1, 1, 500), sc(1, 2, 500), sc(1, 3, 500), sc(2, 1, 400), sc(2, 2, 400), sc(3, 1, 10), sc(4, 1, 20), sc(4, 2, 20), sc(5, 1, 1), sc(5, 1, 2), sc(5, 1, 3)];
  const fp = [sc(2, 1, 9999, true), sc(2, 2, 9999, true), sc(3, 2, 9999, true), sc(3, 2, 1, true), ...[1, 2, 3, 4, 5, 6].map(v => sc(4, 2, v, true))];

  it('standings and awards are the same with or without free-play scores', () => {
    const a = computeStandings({ machines: M, players: P, scores: tourney });
    const b = computeStandings({ machines: M, players: P, scores: [...tourney, ...fp] });
    expect(b.ranked.map(st => [st.player.id, st.rating])).toEqual(a.ranked.map(st => [st.player.id, st.rating]));
    expect(b.meta.totalScores).toBe(a.meta.totalScores);
    expect(b.stats.get(3).plays).toBe(1); // P3's free-play games aren't games played
    const wa = computeAwards({ machines: M, players: P, scores: tourney, standings: a, matchDigits: 0 });
    const wb = computeAwards({ machines: M, players: P, scores: [...tourney, ...fp], standings: b, matchDigits: 0 });
    expect(wb.champion.player.id).toBe(1);
    expect(wb.machineChamps.map(c => c.player?.id)).toEqual(wa.machineChamps.map(c => c.player?.id));
    expect(wa.grinder.player.id).toBe(5); // P4's 6 free-play games don't make them the Grinder
    expect(wb.grinder.player.id).toBe(5);
    expect(wb.theMatch?.value).toBe(wa.theMatch?.value); // totals ignore free play
  });

  it('includeFreePlay standings see every game tonight (free-play board moments)', () => {
    const n = computeStandings({ machines: M, players: P, scores: [...tourney, ...fp], includeFreePlay: true });
    expect(n.machines[0].champion.player.id).toBe(2);
    expect(n.stats.get(4).plays).toBe(8);
    expect(n.machines[0].champion.score).toBe(9999);
  });

  it('high score tables: one row per player (their best), all games, free-play bests marked, voided skipped', () => {
    const scores = [...tourney, ...fp, { ...sc(1, 1, 99999), voided: true }];
    const [m1, m2] = computeHighScores({ machines: M, players: P, scores, n: 10 });
    expect(m1.top.map(r => [r.player.id, r.score, r.freePlay])).toEqual([[2, 9999, true], [1, 500, false], [4, 20, false], [3, 10, false], [5, 3, false]]);
    expect(m2.top.map(r => r.player.id)).toEqual([2, 3, 1, 4]);
    expect(m2.top.find(r => r.player.id === 3).score).toBe(9999);
    expect(computeHighScores({ machines: M, players: P, scores, n: 2 })[0].top).toHaveLength(2);
  });
});
