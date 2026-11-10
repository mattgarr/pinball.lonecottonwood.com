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

  it('The Match ignores the final 0 (pinball scores end in 0)', () => {
    const PP = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, display_name: `P${i + 1}`, color: '#fff', emoji: '🎯' }));
    // P1 is machine 1's champion and P2 the Grinder, so P3 and P4 are free for The Match.
    const scores = [sc(1, 1, 99_999_990), sc(2, 2, 10), sc(2, 2, 20), sc(2, 3, 30), sc(3, 1, 1_234_510), sc(4, 1, 9_876_420)];
    const standings = computeStandings({ machines: M, players: PP, scores });
    // drawn 42 → 9,876,420 ("42" before the last 0) wins over 1,234,510 ("51")
    const a = computeAwards({ machines: M, players: PP, scores, standings, matchDigits: 42 });
    expect(a.theMatch.player.id).toBe(4);
    expect(a.matchDrawn).toBe(true);
  });

  it('The Match tie is not decided by who logged first', () => {
    const PP = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, display_name: `P${i + 1}`, color: '#fff', emoji: '🎯' }));
    // Every score has the same two digits ("00"): the winner should depend on the draw.
    const scores = PP.map(p => sc(p.id, 1, 1_000_000 + p.id * 1000));
    const standings = computeStandings({ machines: M, players: PP, scores });
    const winners = new Set([0, 1, 2, 3, 4, 5, 6, 7].map(d => computeAwards({ machines: M, players: PP, scores, standings, matchDigits: d }).theMatch?.player.id));
    expect(winners.size).toBeGreaterThan(1);
  });

  it('billions keep two decimals so close scores do not look tied', () => {
    expect(fmtShort(1_040_000_000)).toBe('1.04B');
    expect(fmtShort(1_010_000_000)).toBe('1.01B');
    expect(fmtShort(2_000_000_000)).toBe('2B');
  });
});
