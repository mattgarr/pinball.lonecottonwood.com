import { describe, it, expect } from 'vitest';
import {
  tourneyPhase, countdown, finalSeconds, dueClockMoment, clockOffset, bestOffset, sealed, scoreCountsNow,
  nextBoundary, fmtCountdown, pacificToIso, isoToPacific, LOG_GRACE_MS, GRACE_MS,
} from './schedule.js';

const T0 = Date.parse('2026-11-15T03:30:00Z'); // 7:30 PM Pacific on Nov 14
const T1 = Date.parse('2026-11-15T06:30:00Z'); // 10:30 PM
const party = (o = {}) => ({ status: 'open', reveal_active: false, free_play: false, match_digits: null, revealed_at: null,
  tourney_starts_at: new Date(T0).toISOString(), tourney_ends_at: new Date(T1).toISOString(), ...o });
const MIN = 60000;

describe('tournament phase', () => {
  it('walks pre → on → grace → over at the exact edges', () => {
    const p = party();
    expect(tourneyPhase(p, T0 - 1)).toBe('pre');
    expect(tourneyPhase(p, T0)).toBe('on');
    expect(tourneyPhase(p, T1 - 1)).toBe('on');
    expect(tourneyPhase(p, T1)).toBe('grace');
    expect(tourneyPhase(p, T1 + LOG_GRACE_MS - 1)).toBe('grace');
    expect(tourneyPhase(p, T1 + LOG_GRACE_MS)).toBe('over');
  });
  it('scores count only in the window plus the logging grace (same rule as the database)', () => {
    const p = party();
    expect(scoreCountsNow(p, T0 - 1)).toBe(false);
    expect(scoreCountsNow(p, T0)).toBe(true);
    expect(scoreCountsNow(p, T1 + LOG_GRACE_MS - 1)).toBe(true);
    expect(scoreCountsNow(p, T1 + LOG_GRACE_MS)).toBe(false);
    expect(scoreCountsNow(party({ free_play: true }), T0 + MIN)).toBe(false);
  });
  it('no times set behaves like before; reveal and manual free play win', () => {
    const p = { status: 'open' };
    expect(tourneyPhase(p, T0)).toBe('on');
    expect(tourneyPhase({ status: 'closed' }, T0)).toBe('closed');
    expect(tourneyPhase(party({ reveal_active: true }), T1 + 10 * MIN)).toBe('reveal');
    expect(tourneyPhase(party({ free_play: true }), T0 + MIN)).toBe('free');
  });
  it('next boundary: seal, end, grace end', () => {
    const p = party();
    expect(nextBoundary(p, T0 - 5)).toBe(T0);
    expect(nextBoundary(p, T0 + 1)).toBe(T1 - 15 * MIN);
    expect(nextBoundary(p, T1)).toBe(T1 + LOG_GRACE_MS);
    expect(nextBoundary(p, T1 + LOG_GRACE_MS)).toBe(null);
  });
  it('sealed from 15 min before the end until the reveal starts', () => {
    expect(sealed(party(), T1 - 15 * MIN - 1)).toBe(false);
    expect(sealed(party(), T1 - 15 * MIN)).toBe(true);
    expect(sealed(party(), T1 + 30 * MIN)).toBe(true);
    expect(sealed(party({ reveal_active: true }), T1 + MIN)).toBe(false);
    expect(sealed(party({ revealed_at: new Date(T1 + 5 * MIN).toISOString() }), T1 + 30 * MIN)).toBe(false); // the reveal happened
    expect(sealed(party({ match_digits: 50, revealed_at: '2026-11-10T15:00:00Z' }), T1 + MIN)).toBe(true); // an old test reveal doesn't unseal
    expect(sealed({ status: 'open' }, T1)).toBe(false);
  });
});

describe('countdowns', () => {
  it('chip and final seconds', () => {
    expect(countdown(party(), T0 - 90000)).toMatchObject({ kind: 'start', ms: 90000 });
    expect(countdown(party(), T1 - 5000)).toMatchObject({ kind: 'end', ms: 5000 });
    expect(countdown(party(), T1 + 1000)).toMatchObject({ kind: 'log', ms: LOG_GRACE_MS - 1000 });
    expect(countdown({ status: 'open' }, T0)).toBe(null);
    expect(finalSeconds(party(), T1 - 10000)).toBe(10);
    expect(finalSeconds(party(), T1 - 9001)).toBe(10);
    expect(finalSeconds(party(), T1 - 1)).toBe(1);
    expect(finalSeconds(party(), T1)).toBe(0);
    expect(finalSeconds(party(), T1 - 10001)).toBe(0);
    expect(finalSeconds(party({ reveal_active: true }), T1 - 5000)).toBe(0);
    expect(fmtCountdown(3_723_000)).toBe('1:02:03');
    expect(fmtCountdown(61_000)).toBe('1:01');
    expect(fmtCountdown(500)).toBe('0:01');
  });
});

describe('clock takeovers', () => {
  // Simulate a TV checking every second over a stretch of time; returns the keys fired, in order.
  const run = (p, from, to, fired = new Set()) => {
    const out = [];
    for (let t = from; t <= to; t += 1000) {
      const m = dueClockMoment(p, t, fired);
      if (m) { fired.add(m.key); out.push(`${m.kind}:${m.minutes}`); }
    }
    return out;
  };
  it('each mark fires exactly once, in order: 5…1 and the start, 15/10/5…1 and the end', () => {
    const p = party();
    expect(run(p, T0 - 20 * MIN, T0 + MIN)).toEqual(['start:5', 'start:4', 'start:3', 'start:2', 'start:1', 'start:0']);
    expect(run(p, T1 - 30 * MIN, T1 + 5 * MIN)).toEqual(['end:15', 'end:10', 'end:5', 'end:4', 'end:3', 'end:2', 'end:1', 'end:0']);
  });
  it('no backlog: a TV that wakes up mid-countdown only shows marks within the last 30 s', () => {
    const p = party();
    // asleep from T1-16min to T1-4min+10s: wakes 10 s after the 4-minute mark → shows only that one
    expect(run(p, T1 - 4 * MIN + 10000, T1 - 3 * MIN - 31000)).toEqual(['end:4']);
    // wakes 40 s after the 4-minute mark → nothing until 3
    expect(run(p, T1 - 4 * MIN + 40000, T1 - 3 * MIN + 1000)).toEqual(['end:3']);
    // reload: the fired set is remembered, so the same mark doesn't fire twice
    const fired = new Set();
    run(p, T1 - 2 * MIN, T1 - 2 * MIN + 5000, fired);
    expect(run(p, T1 - 2 * MIN + 6000, T1 - 2 * MIN + GRACE_MS - 1000, fired)).toEqual([]);
  });
  it('a schedule set in the past plays nothing old; reveal / free play play nothing', () => {
    expect(run(party(), T1 + 10 * MIN, T1 + 20 * MIN)).toEqual([]);
    expect(run(party({ reveal_active: true }), T1 - 16 * MIN, T1 + MIN)).toEqual([]);
    expect(run(party({ free_play: true }), T0 - 6 * MIN, T0 + MIN)).toEqual([]);
  });
  it('moving the end (+15 min) gives fresh marks for the new time', () => {
    const fired = new Set();
    run(party(), T1 - 6 * MIN, T1 - 4 * MIN - 30000, fired); // saw 5 (and nothing else)
    const later = party({ tourney_ends_at: new Date(T1 + 15 * MIN).toISOString() });
    expect(run(later, T1 - 4 * MIN, T1 + MIN, fired)).toEqual(['end:15']);
  });
});

describe('server clock offset', () => {
  it('midpoint of the round trip', () => {
    // sent at 1000, back at 1200 (local); the server said 10_100 → the server is 9000 ms ahead
    expect(clockOffset(1000, 1200, new Date(10_100).toISOString())).toBe(9000);
    expect(clockOffset(1000, 1200, 'nonsense')).toBe(null);
  });
  it('best of several samples is the shortest round trip', () => {
    expect(bestOffset([{ offset: 50, rtt: 300 }, { offset: 20, rtt: 40 }, null, { offset: null, rtt: 1 }])).toBe(20);
    expect(bestOffset([null])).toBe(null);
  });
});

describe('Pacific time', () => {
  it('round-trips wall-clock times, standard and daylight time', () => {
    expect(pacificToIso('2026-11-14T19:30')).toBe('2026-11-15T03:30:00.000Z'); // PST
    expect(pacificToIso('2026-07-04T19:30')).toBe('2026-07-05T02:30:00.000Z'); // PDT
    expect(isoToPacific('2026-11-15T03:30:00.000Z')).toBe('2026-11-14T19:30');
    expect(pacificToIso('')).toBe(null);
  });
});
