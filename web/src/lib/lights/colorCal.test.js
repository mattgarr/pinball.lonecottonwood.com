import { describe, it, expect } from 'vitest';
import { calColor, uncalColor, calPayload, hueWarp, hueOf } from './colorCal.js';
import { LIGHTS } from './config.js';
import { LightsEngine } from './engine.js';

describe('strip hue correction (Matt\'s bench tests, 2026-11-12)', () => {
  it('hits the two measured points exactly', () => {
    for (const { intended, sent } of LIGHTS.colorCal.points) expect(calColor([...intended, 0])).toEqual([...sent, 0]);
    expect(calColor([255, 110, 0, 0])).toEqual([255, 18, 0, 0]); // traffic-cone orange
    expect(calColor([255, 190, 0, 0])).toEqual([255, 54, 0, 0]); // school-bus gold
  });
  it('reins in green on other warm colors (gold 170, deep orange, lightning yellow, amber)', () => {
    expect(calColor([255, 170, 0, 0])[1]).toBeGreaterThan(35);
    expect(calColor([255, 170, 0, 0])[1]).toBeLessThan(54);
    expect(calColor([255, 80, 0, 0])[1]).toBeLessThan(18);
    expect(calColor([255, 220, 60, 0])[1]).toBeLessThan(120);
    expect(calColor([255, 255, 0, 0])[1]).toBeLessThan(120); // yellow lands above gold, below the old "yellow" 110
    expect(calColor([255, 255, 0, 0])[1]).toBeGreaterThan(54);
  });
  it('keeps red, green, blue, white, grays, the W chip and the deep violet exactly', () => {
    for (const c of [[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0], [255, 255, 255, 0], [128, 128, 128, 0], [0, 0, 0, 255],
      [0, 0, 0, 0], [139, 0, 200, 0], [100, 0, 0, 0]]) {
      expect(calColor(c)).toEqual(c);
    }
    const g = calColor([255, 140, 20, 90]);
    expect(g[3]).toBe(90); expect(g[0]).toBe(255); expect(g[2]).toBe(20); // max, min and W kept
  });
  it('keeps max channel and saturation (only the hue moves) and barely touches pale colors', () => {
    for (const c of [[0, 230, 210, 0], [255, 40, 170, 0], [30, 70, 255, 0], [200, 150, 255, 0], [10, 25, 45, 200]]) {
      const o = calColor(c);
      expect(Math.max(...o.slice(0, 3))).toBe(Math.max(...c.slice(0, 3)));
      expect(Math.min(...o.slice(0, 3))).toBe(Math.min(...c.slice(0, 3)));
    }
    const pale = calColor([240, 230, 255, 0]); // S ≈ 0.1
    for (let j = 0; j < 3; j++) expect(Math.abs(pale[j] - [240, 230, 255][j])).toBeLessThanOrEqual(1);
  });
  it('follows the hue-wheel test: green→blue leans green, blue→red leans blue', () => {
    expect(hueOf(calColor([0, 255, 255, 0]))).toBeGreaterThan(150); // cyan: between spring green and cyan
    expect(hueOf(calColor([0, 255, 255, 0]))).toBeLessThan(170);
    expect(calColor([0, 255, 255, 0])[2]).toBeLessThan(200); // much less blue
    expect(hueOf(calColor([0, 128, 255, 0]))).toBeLessThan(195); // azure sent cyan-ish
    const mag = calColor([255, 0, 255, 0]);
    expect(mag[2]).toBeGreaterThan(mag[0]); // magenta: more blue than red
    expect(hueOf(calColor([128, 0, 255, 0]))).toBeLessThan(270); // violet toward blue
    for (const { intended } of LIGHTS.colorCal.points) expect(hueOf(calColor([...intended, 0]))).toBeLessThan(hueOf(intended)); // warm leans red
  });
  it('the hue warp is monotonic and continuous around the whole wheel (red, green, blue fixed)', () => {
    let prev = -1;
    for (let i = 0; i < 3600; i++) {
      const v = hueWarp(i / 10);
      expect(v).toBeGreaterThanOrEqual(prev);
      if (i) expect(v - prev).toBeLessThan(0.5); // no jumps (slopes stay under 5)
      prev = v;
    }
    expect(360 - prev).toBeLessThan(0.5); // closes the circle at red
    expect(hueWarp(0)).toBe(0);
    expect(hueWarp(120)).toBeCloseTo(120, 9);
    expect(hueWarp(240)).toBeCloseTo(240, 9);
    expect(hueWarp(hueOf([139, 0, 200]))).toBeCloseTo(hueOf([139, 0, 200]), 9);
    let g = -1;
    for (let x = 0; x <= 255; x++) { const c = calColor([255, x, 0, 0]); expect(c[0]).toBe(255); expect(c[1]).toBeGreaterThanOrEqual(g); g = c[1]; }
  });
  it('is continuous as saturation falls (the correction fades out, no jumps)', () => {
    let prev = calColor([0, 255, 255, 0]);
    for (let r = 1; r <= 255; r++) {
      const c = calColor([r, 255, 255, 0]);
      expect(Math.max(...[0, 1, 2].map(j => Math.abs(c[j] - prev[j])))).toBeLessThanOrEqual(4);
      prev = c;
    }
    expect(prev).toEqual([255, 255, 255, 0]);
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
    for (const c of [[255, 110, 0, 0], [255, 190, 0, 0], [255, 220, 60, 0], [255, 140, 20, 90], [124, 255, 0, 0], [255, 40, 170, 0],
      [0, 255, 255, 0], [0, 128, 255, 0], [30, 70, 255, 0], [128, 0, 255, 0], [255, 0, 255, 0], [255, 0, 128, 0], [0, 230, 210, 0], [200, 150, 255, 0]]) {
      const back = uncalColor(calColor(c));
      for (let j = 0; j < 4; j++) expect(Math.abs(back[j] - c[j])).toBeLessThanOrEqual(3);
    }
  });
  it('corrects every col in a WLED message and leaves the rest alone', () => {
    const msg = { on: true, bri: 160, seg: [{ id: 2, fx: 0, col: [[255, 110, 0, 0], [0, 90, 240, 0]] }, { id: 3, on: false }] };
    const out = calPayload(msg);
    expect(out.seg[0].col).toEqual([[255, 18, 0, 0], calColor([0, 90, 240, 0])]);
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

describe('deep violet (Matt\'s bench test, 2026-11-12)', () => {
  it('is the app\'s purple everywhere, and the warm curve leaves it alone', () => {
    expect(LIGHTS.colorCal.violet).toEqual([139, 0, 200, 0]);
    expect(LIGHTS.coolColors.purple).toEqual([139, 0, 200, 0]);
    expect(LIGHTS.machineThemes[6].colors[0]).toEqual([139, 0, 200, 0]);
    expect(LIGHTS.partyBase.col[0]).toEqual([139, 0, 200, 0]);
    expect(calColor([139, 0, 200, 0])).toEqual([139, 0, 200, 0]); // a fixed point of the hue warp
    expect(LIGHTS.machineThemes[6].colors.slice(1)).toEqual([[230, 0, 170, 0], [200, 150, 255, 0]]); // magenta, lavender kept
  });
});
