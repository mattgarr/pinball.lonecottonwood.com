import { describe, it, expect } from 'vitest';
import { computeStandings, computeAwards, fmtShort, ordinal, tieBreakNote, winnersList, PODIUM_MIN } from './scoring.js';

const M = [1, 2, 3].map(id => ({ id, name: `M${id}`, manufacturer: 'X', year: 1990, sort_order: id, active: true }));
const P = [1, 2, 3, 4].map(id => ({ id, display_name: `P${id}`, color: '#fff', emoji: '🎯' }));
let sid = 1;
const sc = (player_id, machine_id, value) => ({ id: sid++, player_id, machine_id, value, voided: false });

describe('scoring', () => {
  it('ranks always follow the prize order, so a tie never shows two #1s', () => {
    // P1 and P2 end up with the same rating; P1 holds more crowns.
    const scores = [sc(1, 1, 900), sc(2, 1, 800), sc(1, 2, 100), sc(2, 2, 200), sc(1, 3, 50), sc(2, 3, 50), sc(3, 1, 10), sc(3, 2, 10), sc(3, 3, 1), sc(4, 1, 5), sc(4, 2, 5), sc(4, 3, 1)];
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

  it('The Match: nobody matches → everyone left is in the spin', () => {
    const PP = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, display_name: `P${i + 1}`, color: '#fff', emoji: '🎯' }));
    const scores = [sc(1, 1, 99_999_990), sc(2, 2, 10), sc(2, 2, 20), sc(2, 3, 30), sc(3, 1, 1_234_560), sc(4, 1, 9_876_420), sc(5, 1, 5), sc(5, 1, 5), sc(5, 1, 5)];
    const standings = computeStandings({ machines: M, players: PP, scores });
    const a = computeAwards({ machines: M, players: PP, scores, standings, matchDigits: 70 });
    expect(a.theMatch.exact).toBe(false);
    expect(a.theMatch.tied.map(p => p.id).sort()).toEqual([3, 4]);
    expect(a.theMatch.pool).toEqual([]);
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

  it('the podium needs 3+ machines: a 2-machine leader is rated and ranked, but skipped for the podium', () => {
    // P1 tops two machines (rating 100) but plays only 2; P2, P3, P4 play all 3.
    const scores = [sc(1, 1, 999), sc(1, 2, 999),
      sc(2, 1, 500), sc(2, 2, 500), sc(2, 3, 500),
      sc(3, 1, 400), sc(3, 2, 400), sc(3, 3, 400),
      sc(4, 1, 300), sc(4, 2, 300), sc(4, 3, 300)];
    const standings = computeStandings({ machines: M, players: P, scores });
    expect(PODIUM_MIN).toBe(3);
    expect(standings.ranked[0].player.id).toBe(1); // still #1 on the board
    expect(standings.ranked[0].rating).toBe(100);
    const a = computeAwards({ machines: M, players: P, scores, standings });
    expect([a.champion.player.id, a.second.player.id, a.third.player.id]).toEqual([2, 3, 4]);
    // P1 still wins something else: a machine champion (their top scores).
    expect(a.machineChamps.some(c => c.player?.id === 1)).toBe(true);
  });

  it('nobody with 3 machines: no podium winners, but everyone is still rated', () => {
    const scores = [sc(1, 1, 9), sc(1, 2, 9), sc(2, 1, 5), sc(2, 2, 5)];
    const standings = computeStandings({ machines: M, players: P, scores });
    expect(standings.ranked.length).toBe(2);
    const a = computeAwards({ machines: M, players: P, scores, standings });
    expect(a.champion).toBeNull();
    expect(a.second).toBeNull();
  });

  it('ranks sort on the unrounded rating; the tie-break note explains a shared shown rating', () => {
    // 3 machines with 3, 3 and 7 players: standings 100/67/33 and 100/86/71/57/43/29/14 (exact).
    const PP = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, display_name: `P${i + 1}`, color: '#fff', emoji: '🎯' }));
    const exactOf = (st) => st.exact;
    const scores = [];
    // Machine 1 (3 players): A=P1 1st, B=P2 2nd, P3 3rd
    scores.push(sc(1, 1, 300), sc(2, 1, 200), sc(3, 1, 100));
    // Machine 2 (3 players): B 1st, A 2nd
    scores.push(sc(2, 2, 300), sc(1, 2, 200), sc(3, 2, 100));
    // Machine 3 (7 players): A 3rd (71.4), B 4th (57.1)
    scores.push(sc(4, 3, 700), sc(5, 3, 600), sc(1, 3, 500), sc(2, 3, 400), sc(6, 3, 300), sc(7, 3, 200), sc(8, 3, 100));
    const standings = computeStandings({ machines: M, players: PP, scores });
    const A = standings.stats.get(1), B = standings.stats.get(2);
    // A: (100 + 66.67 + 71.43) / 3 = 79.37; B: (66.67 + 100 + 57.14) / 3 = 74.6
    expect(exactOf(A)).toBeCloseTo(79.365, 2);
    expect(A.rating).toBe(79);
    expect(standings.ranked.indexOf(A)).toBeLessThan(standings.ranked.indexOf(B));
    // Two made-up stats rows with the same shown rating:
    const mk = (id, exact, crowns = 0, machinesPlayed = 3) => ({ player: { id }, rating: Math.round(exact), exact, crowns, machinesPlayed });
    expect(tieBreakNote(mk(1, 87.4), mk(2, 87.1))).toBe('Tied at 87 · 87.4 vs 87.1 before rounding');
    expect(tieBreakNote(mk(1, 87.04), mk(2, 87.01))).toBe('Tied at 87 · 87.04 vs 87.01 before rounding');
    expect(tieBreakNote(mk(1, 87, 2), mk(2, 87, 1))).toBe('Tied at 87 · more machine crowns');
    expect(tieBreakNote(mk(1, 87, 1, 4), mk(2, 87, 1, 3))).toBe('Tied at 87 · more machines played');
    expect(tieBreakNote(mk(1, 87), mk(2, 87))).toBe('Tied at 87 · joined first');
    expect(tieBreakNote(mk(1, 88), mk(2, 87))).toBeNull();
  });

  it('exactly equal ratings fall back to crowns, then machines, then who joined first', () => {
    // P1 and P2 split two 2-player machines and tie the third: equal exact ratings and one crown each... P1 joined first.
    const scores = [sc(1, 1, 9), sc(2, 1, 1), sc(2, 2, 9), sc(1, 2, 1), sc(1, 3, 5), sc(2, 3, 5)];
    const standings = computeStandings({ machines: M, players: P, scores });
    expect(standings.ranked.map(st => st.player.id)).toEqual([1, 2]);
    expect(tieBreakNote(standings.ranked[0], standings.ranked[1])).toMatch(/^Tied at \d+ · (more machine crowns|joined first)$/);
  });

  it('winners list: all 12 prizes in reveal order, empty prizes kept, The Match with its number', () => {
    const scores = [sc(1, 1, 900), sc(2, 1, 800), sc(1, 2, 100), sc(2, 2, 200), sc(1, 3, 50), sc(2, 3, 40), sc(3, 1, 10), sc(3, 2, 10), sc(3, 3, 1), sc(4, 1, 5)];
    const standings = computeStandings({ machines: M, players: P, scores });
    const awards = computeAwards({ machines: M, players: P, scores, standings, matchDigits: 0 });
    const list = winnersList(awards);
    expect(list.map(w => w.prize)).toEqual(['Grand Champion', '2nd Place', '3rd Place', 'M1 Champion', 'M2 Champion', 'M3 Champion', 'The Grinder', 'The Big Whiff', 'The Match']);
    expect(list[0].player.id).toBe(awards.champion.player.id);
    expect(list[0].stat).toBe(`${awards.champion.rating}/100`);
    for (const w of list) if (!w.player) expect(w.stat).toBe('');
    if (awards.theMatch) expect(list.at(-1).stat).toBe('Match 00');
    expect(winnersList({}).every(w => w.player === null)).toBe(true);
  });

  it('ordinals (the Big Whiff\'s "lowlight: 22nd of 22")', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 112].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '112th']);
  });
});
