import { describe, expect, it } from 'vitest';
import { COUNT_MS, DRAW_MS, REEL_MS, HOLD_MS, WALK_IN, showAt, soundPlan, walkTimes } from './revealTiming.js';

const rows = n => Array.from({ length: n }, () => ({}));
describe('reveal sound plan (scheduled ahead of the picture by the Audio delay)', () => {
  it('Grand Champion: 3-2-1 ticks, then the big sting when the winner lands', () => {
    const p = soundPlan({ label: 'GRAND CHAMPION', title: 'A' });
    expect(p).toEqual([{ at: 0, s: 'tick' }, { at: COUNT_MS, s: 'tick' }, { at: 2 * COUNT_MS, s: 'tick' }, { at: 3 * COUNT_MS, s: 'grandSting' }]);
  });
  it('a machine champion: 3-2-1, a ratchet per row the walk moves down, a ding as it lands, then the sting', () => {
    const sl = { label: 'FATHOM CHAMPION', title: 'B', walk: { rows: rows(5), win: 2 } };
    const p = soundPlan(sl);
    const { step, land } = walkTimes(sl.walk);
    expect(p.filter(e => e.s === 'step').map(e => e.at)).toEqual([3000 + WALK_IN + step, 3000 + WALK_IN + 2 * step]);
    expect(p.find(e => e.s === 'land').at).toBe(3000 + land);
    expect(p.at(-1)).toEqual({ at: showAt(sl), s: 'sting' });
  });
  it('a walk that runs off the end (nobody left): no ratchet past the last row, the soft no-winner', () => {
    const sl = { label: 'THE GRINDER', empty: true, walk: { rows: rows(3), win: -1 }, walkOnly: true };
    const p = soundPlan(sl);
    expect(p.filter(e => e.s === 'step')).toHaveLength(2);
    expect(p.at(-1).s).toBe('noWinner');
  });
  it('The Match: 23 roll ticks slowing down, the land, clacks slowing down, the stop, the sting', () => {
    const sl = { label: 'THE MATCH', title: 'C', spin: { drawn: 40, items: rows(4) } };
    const p = soundPlan(sl);
    const rolls = p.filter(e => e.s === 'roll').map(e => e.at);
    expect(rolls).toHaveLength(23);
    expect(rolls[1] - rolls[0]).toBeLessThan(rolls[22] - rolls[21]);
    const clacks = p.filter(e => e.s === 'clack').map(e => e.at);
    expect(clacks.length).toBeGreaterThan(15);
    expect(clacks.every((t, i) => !i || t - clacks[i - 1] > 45)).toBe(true);
    expect(p.find(e => e.s === 'stop').at).toBe(DRAW_MS + REEL_MS);
    expect(p.at(-1)).toEqual({ at: DRAW_MS + REEL_MS + HOLD_MS, s: 'sting' });
  });
  it('intro / finale stings; Back or a reload: silence', () => {
    expect(soundPlan({ label: 'AWARDS CEREMONY', intro: true, hold: true })).toEqual([{ at: 0, s: 'introSting' }]);
    expect(soundPlan({ label: 'X', finale: true, hold: true })).toEqual([{ at: 0, s: 'finaleSting' }]);
    expect(soundPlan({ label: 'GRAND CHAMPION', title: 'A' }, { instant: true })).toEqual([]);
  });
});
