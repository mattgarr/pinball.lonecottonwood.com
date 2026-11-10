import { describe, it, expect } from 'vitest';
import { buildPresets } from './presets.js';
import { LIGHTS } from './config.js';

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
        else expect(s.on).toBe(false);
      }
    }
  });
  it('is small enough for the controller', () => {
    expect(JSON.stringify(p).length).toBeLessThan(60000);
  });
});
