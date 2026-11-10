import { describe, it, expect } from 'vitest';
import { computeStandings, computeAwards, fmtShort } from './scoring.js';

const M = [1, 2, 3].map(id => ({ id, name: `M${id}`, manufacturer: 'X', year: 1990, sort_order: id, active: true }));
const P = [1, 2, 3, 4].map(id => ({ id, display_name: `P${id}`, color: '#fff', emoji: '🎯' }));
let sid = 1;
const sc = (player_id, machine_id, value) => ({ id: sid++, player_id, machine_id, value, voided: false });

describe('scoring', () => {
  it('ranks always follow the prize order, so a tie never shows two #1s', () => {
    // P1 and P2 end up with the same rating; P1 holds more crowns.
    const scores = [sc(1, 1, 900), sc(2, 1, 800), sc(1, 2, 100), sc(2, 2, 200), sc(3, 1, 10), sc(3, 2, 10), sc(4, 1, 5), sc(4, 2, 5)];
    const standings = computeStandings({ machines: M, players: P, scores });
    const ranks = standings.ranked.map(st => st.rank);
    expect(new Set(ranks).size).toBe(ranks.length); // no shared ranks
    const awards = computeAwards({ machines: M, players: P, scores, standings });
    expect(awards.champion.player.id).toBe(standings.ranked[0].player.id);
    expect(awards.second.player.id).toBe(standings.ranked[1].player.id);
    expect(standings.ranked[0].rank).toBe(1);
  });

  it('The Match: drawn 00–90, matched on the last two digits of each player\'s total points', () => {
    const PP = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, display_name: `P${i + 1}`, color: '#fff', emoji: '🎯' }));
    // P1 is machine 1's champion and P2 the Grinder, so P3–P6 are free for The Match.
    const scores = [sc(1, 1, 99_999_990), sc(2, 2, 10), sc(2, 2, 20), sc(2, 3, 30), sc(2, 3, 30),
      sc(3, 1, 1_234_540),                 // total ends in 40
      sc(4, 1, 9_876_420), sc(4, 1, 20),   // 9,876,440: ends in 40 only when added up
      sc(5, 1, 5_540), sc(5, 1, 110),      // 5,650: one game ends in 40, the total does not
      sc(6, 1, 70), sc(6, 1, 70), sc(6, 1, 70)]; // P6: most games → The Grinder
    const standings = computeStandings({ machines: M, players: PP, scores });
    const a = computeAwards({ machines: M, players: PP, scores, standings, matchDigits: 47 }); // → 40
    expect(a.theMatch.drawn).toBe(40);
    expect(a.theMatch.exact).toBe(true);
    expect(a.theMatch.tied.map(p => p.id).sort()).toEqual([3, 4]);
    expect(a.theMatch.tied[0].id).toBe(a.theMatch.player.id);
    expect(a.theMatch.pool.map(p => p.id)).toEqual([5]);
    expect([1_234_540, 9_876_440]).toContain(a.theMatch.value);
  });

  it('The Match: nobody matches exactly → the closest totals are in', () => {
    const PP = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, display_name: `P${i + 1}`, color: '#fff', emoji: '🎯' }));
    const scores = [sc(1, 1, 99_999_990), sc(2, 2, 10), sc(2, 2, 20), sc(2, 3, 30), sc(3, 1, 1_234_560), sc(4, 1, 9_876_420), sc(5, 1, 5), sc(5, 1, 5), sc(5, 1, 5)];
    const standings = computeStandings({ machines: M, players: PP, scores });
    const a = computeAwards({ machines: M, players: PP, scores, standings, matchDigits: 70 });
    expect(a.theMatch.exact).toBe(false);
    expect(a.theMatch.player.id).toBe(3); // 60 is 10 away from 70; 20 is 50 away
  });

  it('The Match tie-break is random by draw, not by who logged first', () => {
    const PP = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, display_name: `P${i + 1}`, color: '#fff', emoji: '🎯' }));
    const scores = PP.map(p => sc(p.id, 1, 1_000_000 + p.id * 1000)); // every score ends in "00"
    const standings = computeStandings({ machines: M, players: PP, scores });
    const winners = new Set([0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map(d => computeAwards({ machines: M, players: PP, scores, standings, matchDigits: d }).theMatch?.player.id));
    expect(winners.size).toBeGreaterThan(1);
  });

  it('billions keep two decimals so close scores do not look tied', () => {
    expect(fmtShort(1_040_000_000)).toBe('1.04B');
    expect(fmtShort(1_010_000_000)).toBe('1.01B');
    expect(fmtShort(2_000_000_000)).toBe('2B');
  });
});
