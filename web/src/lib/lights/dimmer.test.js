import { describe, it, expect, vi, beforeEach } from 'vitest';

// A tiny in-memory broker in place of mqtt.js.
const subs = new Map();
const published = [];
vi.mock('./mqtt.js', () => ({
  publish: (sub, payload, opts) => { published.push({ sub, payload, opts }); for (const fn of subs.get(sub) || []) fn(payload); },
  subscribe: (sub, fn) => { if (!subs.has(sub)) subs.set(sub, new Set()); subs.get(sub).add(fn); return () => subs.get(sub).delete(fn); },
}));
const { followDimmer, saveDimmer, dimmerPct, clampDimmer } = await import('./dimmer.js');
const { LightsEngine } = await import('./engine.js');
const wled = v => { for (const fn of subs.get('g') || []) fn(String(v)); };

describe('dimmer', () => {
  let sent, e, stop;
  beforeEach(() => {
    subs.clear(); published.length = 0; sent = [];
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T20:00:00Z'));
    e = new LightsEngine({ send: p => sent.push(p) });
    stop = followDimmer(e);
  });

  it('the host saves a level (retained) and the TV applies it once', () => {
    saveDimmer(128);
    expect(published[0]).toMatchObject({ sub: 'dimmer', payload: { value: 128 }, opts: { retain: true } });
    expect(sent).toEqual([{ bri: 128 }]);
    wled(128); // WLED confirms: nothing more
    expect(sent).toHaveLength(1);
    stop();
  });
  it('the remote changes brightness: the TV remembers it without echoing it back', () => {
    vi.advanceTimersByTime(5000);
    wled(60);
    expect(e.dimmer).toBe(60);
    expect(sent).toHaveLength(0);
    expect(published.at(-1)).toMatchObject({ sub: 'dimmer', payload: { value: 60 } });
    stop();
  });
  it('a late WLED report of an older level right after a change is ignored', () => {
    saveDimmer(200); saveDimmer(120);
    wled(200);
    expect(e.dimmer).toBe(120);
    wled(0); // off: ignored
    expect(e.dimmer).toBe(120);
    stop();
  });
  it('formats and clamps', () => {
    expect(dimmerPct(255)).toBe(100);
    expect(dimmerPct(128)).toBe(50);
    expect(clampDimmer('abc')).toBe(null);
    expect(clampDimmer(400)).toBe(255);
  });
});
