import { describe, it, expect } from 'vitest';
import { buildPresets } from './presets.js';
import { LIGHTS } from './config.js';
import { newModel, applyMessage, renderRange } from './render.js';

// Mean perceived light of a preset over the top run (simulator's WLED renderer), 0–1.
function meanLight(preset, seconds = 90) {
  const m = newModel();
  const t0 = 1000;
  applyMessage(m, preset);
  for (const s of preset.seg) m.segs[s.id].since = t0;
  let sum = 0, k = 0;
  for (let t = 0; t < seconds; t += 0.5) {
    for (const [r, g, b] of renderRange(m, 0, 235, t0 + t * 1000)) { sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; k++; }
  }
  return sum / k;
}

describe('standalone presets', () => {
  const p = buildPresets();
  it('has seven shows for the remote, off and next-mode', () => {
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(p[id]?.n).toBeTruthy();
    expect(p[8].on).toBe(false);
    expect(p[9].ps).toBe('1~5~');
  });
  it('the showcase lights every machine zone in its own colors', () => {
    const segs = p[5].seg;
    LIGHTS.machineOrder.forEach((id, i) => {
      for (const sid of [LIGHTS.runs.top.firstMachineSeg + i, LIGHTS.runs.curb.firstMachineSeg + i]) {
        expect(segs.find(s => s.id === sid)).toMatchObject({ on: true, col: LIGHTS.machineThemes[id].colors });
        expect(segs.find(s => s.id === sid).start).toBeLessThan(320); // on its real pixels
      }
    });
  });
  it('every playlist points at presets that exist', () => {
    for (const v of Object.values(p)) for (const id of v.playlist?.ps || []) expect(p[id]?.seg).toBeTruthy();
  });
  it('every show lays out segments 0–14 in order, base layers on, machine zones off', () => {
    const valid = new Set(Object.values(LIGHTS.effects));
    for (const v of Object.values(p).filter(v => v.seg)) {
      expect(v.seg.map(s => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
      for (const s of v.seg) {
        expect(s.stop).toBeGreaterThan(s.start);
        if ([0, 1, 8].includes(s.id) || v.n === 'Machine showcase') { expect(s.on).toBe(true); expect(valid.has(s.fx)).toBe(true); }
        else { expect(s.on).toBe(false); expect(s.start).toBeGreaterThanOrEqual(320); }
      }
    }
  });
  it('is small enough for the controller', () => {
    expect(JSON.stringify(p).length).toBeLessThan(60000);
  });
  it('button 6 is Cozy and button 7 is House lights', () => {
    expect(p[6].n).toBe('Cozy');
    expect(p[7].n).toBe('House lights');
  });
  it('no preset sets WLED\'s master brightness, so the host\'s dimmer and the remote keep their level', () => {
    for (const v of Object.values(p)) expect(v.bri).toBeUndefined();
  });
  it('every ambient, attract and calm look gives real room light (brightness floors)', () => {
    const attract = [11, 12, 13, 14, 15, 16].map(id => meanLight(p[id]));
    for (const l of attract) expect(l).toBeGreaterThan(0.22); // was 0.08 for Aurora
    for (const id of [41, 42, 43]) expect(meanLight(p[id])).toBeGreaterThan(0.2); // calm: softer, still usable
    expect(meanLight(p[15])).toBeGreaterThan(0.3); // Aurora specifically (was the dimmest)
    expect(meanLight(p[5])).toBeGreaterThan(0.18); // showcase walls between the machines
  });
});
