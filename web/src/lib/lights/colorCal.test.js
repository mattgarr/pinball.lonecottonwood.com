import { describe, it, expect } from 'vitest';
import { calColor, uncalColor, calPayload, hueCurve } from './colorCal.js';
import { LIGHTS } from './config.js';
import { LightsEngine } from './engine.js';

describe('warm color correction (Matt\'s bench test, 2026-11-12)', () => {
  it('hits the two measured points exactly', () => {
    for (const { intended, sent } of LIGHTS.colorCal.points) expect(calColor([...intended, 0])).toEqual([...sent, 0]);
    expect(calColor([255, 110, 0, 0])).toEqual([255, 18, 0, 0]); // traffic-cone orange
    expect(calColor([255, 190, 0, 0])).toEqual([255, 54, 0, 0]); // school-bus gold
  });
  it('reins in green on other warm colors (gold 170, deep orange, lightning yellow, amber)', () => {
    expect(calColor([255, 170, 0, 0])[1]).toBeGreaterThan(35);
    expect(calColor([255, 170, 0, 0])[1]).toBeLessThan(54);
    expect(calColor([255, 80, 0, 0])[1]).toBeLessThan(18);
    expect(calColor([255, 220, 60, 0])[1]).toBeLessThan(100);
    expect(calColor([255, 255, 0, 0])[1]).toBeLessThan(120); // yellow lands above gold, below the old "yellow" 110
    expect(calColor([255, 255, 0, 0])[1]).toBeGreaterThan(54);
  });
  it('leaves red, green, blues, cyans, purples, pinks, white and the W chip alone', () => {
    for (const c of [[255, 0, 0, 0], [0, 255, 0, 0], [0, 255, 60, 0], [0, 210, 120, 0], [0, 90, 240, 0], [10, 90, 255, 0],
      [0, 229, 255, 0], [0, 230, 210, 0], [140, 40, 255, 0], [120, 0, 255, 0], [255, 40, 170, 0], [230, 0, 170, 0],
      [200, 150, 255, 0], [140, 255, 220, 0], [255, 255, 255, 0], [0, 0, 0, 255], [0, 0, 0, 0], [228, 0, 88, 0]]) {
      expect(calColor(c)).toEqual(c);
    }
    expect(calColor([255, 140, 20, 90])[3]).toBe(90); // W untouched on the intermission glow
    expect(calColor([255, 140, 20, 90])[2]).toBe(20);
  });
  it('the curve is monotonic and continuous from red through yellow to green', () => {
    let prev = -1;
    for (let i = 0; i <= 2000; i++) {
      const s = i / 1000, v = hueCurve(s);
      expect(v).toBeGreaterThanOrEqual(prev);
      if (i) expect(v - prev).toBeLessThan(0.01); // no jumps (max slope ~1.6 → < 0.002 per step)
      prev = v;
    }
    expect(hueCurve(0)).toBe(0);
    expect(hueCurve(2)).toBe(2);
    // sent green rises with intended green; red stays at full
    let g = -1;
    for (let x = 0; x <= 255; x++) { const c = calColor([255, x, 0, 0]); expect(c[0]).toBe(255); expect(c[1]).toBeGreaterThanOrEqual(g); g = c[1]; }
  });
  it('is continuous as blue rises (the correction fades out, no jumps)', () => {
    let prev = calColor([255, 110, 0, 0])[1];
    for (let b = 1; b <= 255; b++) {
      const v = calColor([255, 110, b, 0])[1];
      expect(Math.abs(v - prev)).toBeLessThanOrEqual(3);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBe(110);
  });
  it('is continuous across the whole hue wheel (small hue step → small color step)', () => {
    const hsv = h => { const f = (n, k = (n + h / 60) % 6) => 255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))); return [f(5), f(3), f(1), 0].map(Math.round); };
    let prev = calColor(hsv(0));
    for (let h = 0.5; h <= 360; h += 0.5) {
      const c = calColor(hsv(h));
      expect(Math.max(...[0, 1, 2].map(j => Math.abs(c[j] - prev[j])))).toBeLessThanOrEqual(8);
      prev = c;
    }
  });
  it('uncalColor undoes it (for the simulator view of the strip topic)', () => {
    for (const c of [[255, 110, 0, 0], [255, 190, 0, 0], [255, 220, 60, 0], [255, 140, 20, 90], [124, 255, 0, 0], [255, 40, 170, 0]]) {
      const back = uncalColor(calColor(c));
      for (let j = 0; j < 4; j++) expect(Math.abs(back[j] - c[j])).toBeLessThanOrEqual(3);
    }
  });
  it('corrects every col in a WLED message and leaves the rest alone', () => {
    const msg = { on: true, bri: 160, seg: [{ id: 2, fx: 0, col: [[255, 110, 0, 0], [0, 90, 240, 0]] }, { id: 3, on: false }] };
    const out = calPayload(msg);
    expect(out.seg[0].col).toEqual([[255, 18, 0, 0], [0, 90, 240, 0]]);
    expect(out.seg[1]).toEqual({ id: 3, on: false });
    expect(out.bri).toBe(160);
    expect(msg.seg[0].col[0]).toEqual([255, 110, 0, 0]); // the original isn't changed
  });
  it('engine messages stay in intended colors (correction happens at the MQTT api topic)', () => {
    let sent = [];
    const e = new LightsEngine({ send: p => sent.push(p) });
    e.milestone(); e.flush();
    expect(sent.flatMap(p => p.seg || []).some(s => JSON.stringify(s.col?.[0]) === JSON.stringify(LIGHTS.milestoneGold))).toBe(true);
    e.destroy();
  });
});
