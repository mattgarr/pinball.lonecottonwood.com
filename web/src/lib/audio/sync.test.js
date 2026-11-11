import { describe, expect, it } from 'vitest';
import { DEFAULT_DELAY, browserLatency, delayText, effectiveDelay, findLag, makeChirp, summarize } from './sync.js';

// A simulated garage: the chirp comes back `delay` s later, quieter, with a room echo and noise.
function loopback(sr, delay, { noise = 0.05, gain = 0.3, len = 4.2, seed = 1 } = {}) {
  let x = seed;
  const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647 - 0.5; };
  const chirp = makeChirp(sr);
  const rec = new Float32Array(Math.round(sr * len));
  const put = (at, g) => { const o = Math.round(at * sr); for (let i = 0; i < chirp.length && o + i < rec.length; i++) rec[o + i] += g * chirp[i]; };
  put(delay, gain);
  put(delay + 0.013, gain * 0.4); // an early wall reflection
  put(delay + 0.041, gain * 0.2);
  for (let i = 0; i < rec.length; i++) rec[i] += noise * rnd() * 2;
  return { rec, chirp };
}

describe('mic sync', () => {
  it('finds a 2 s AirPlay delay to the millisecond through echo and noise', () => {
    const sr = 48000;
    for (const d of [0.08, 1.85, 2.0, 2.31]) {
      const { rec, chirp } = loopback(sr, d, { seed: Math.round(d * 100) });
      const f = findLag(rec, chirp, sr);
      expect(Math.abs(f.lag / sr - d)).toBeLessThan(0.002);
      expect(f.ratio).toBeGreaterThan(1.5);
    }
  });
  it('sees a weak signal as weak', () => {
    const sr = 24000;
    const { rec, chirp } = loopback(sr, 2.0, { gain: 0.002, noise: 0.3 });
    expect(findLag(rec, chirp, sr).ratio).toBeLessThan(2.5);
  });
  it('summarizes runs: median, spread, confidence; too few good runs is an error', () => {
    const r = summarize([{ sec: 2.01, ratio: 6 }, { sec: 1.99, ratio: 5 }, { sec: 2.0, ratio: 7 }, { sec: 2.6, ratio: 1.2 }, null]);
    expect(r).toMatchObject({ ok: true, sec: 2.0, good: 3, confidence: 'high' });
    expect(summarize([{ sec: 2, ratio: 1.1 }, { sec: 2, ratio: 1.3 }]).ok).toBe(false);
  });
  it('picks the delay: manual / mic override, plausible browser latency, else the 2.0 s default', () => {
    expect(effectiveDelay({}, null)).toMatchObject({ sec: DEFAULT_DELAY, source: 'default' });
    expect(effectiveDelay({ delayMode: 'auto', audioDelay: 2 }, 1.93)).toMatchObject({ sec: 1.93, source: 'auto' });
    expect(effectiveDelay({ delayMode: 'auto', audioDelay: 2 }, 0.02)).toMatchObject({ sec: 2, source: 'default' }); // a cable / built-in speakers report tiny numbers
    expect(effectiveDelay({ delayMode: 'manual', audioDelay: 0.4 }, 1.9)).toMatchObject({ sec: 0.4, source: 'manual' });
    expect(effectiveDelay({ delayMode: 'manual', audioDelay: 9, delaySource: 'mic' })).toMatchObject({ sec: 3, source: 'mic' });
    expect(delayText(effectiveDelay({}, 1.9))).toBe('Auto (1.9 s from the Mac)');
    expect(delayText(effectiveDelay({ delayMode: 'manual', audioDelay: 2 }))).toBe('Manual 2.0 s');
    expect(delayText(effectiveDelay({}))).toBe('Auto unavailable → using 2.0 s');
    expect(browserLatency({ outputLatency: 1.8, baseLatency: 0.01 })).toBeCloseTo(1.81);
    expect(browserLatency({ outputLatency: 0 })).toBe(null);
  });
});
