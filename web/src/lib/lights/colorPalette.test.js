import { describe, it, expect } from 'vitest';
import { rainbowPalette } from './colorPalette.js';
import { buildPresets } from './presets.js';
import { LIGHTS } from './config.js';

describe('rainbow palette (custom palette 0, pal 255)', () => {
  it('has 17 stops from 0 to 255, red at both ends, and is color-corrected', () => {
    const { palette } = rainbowPalette();
    expect(palette.length).toBe(34);
    expect(palette[0]).toBe(0); expect(palette[32]).toBe(255);
    expect(palette[1]).toBe('ff0000'); expect(palette[33]).toBe('ff0000');
    expect(rainbowPalette({ calibrate: false }).palette[9]).not.toBe(palette[9]); // yellow is reined in
  });
  it('Attract alternates deep looks and rainbow looks', () => {
    const pals = LIGHTS.ambientCycle.map(a => a.pal);
    expect(pals).toEqual([4, 255, 4, 255, 4, 255]);
    const p = buildPresets();
    expect([12, 14, 16].map(id => p[id].seg[0].pal)).toEqual([255, 255, 255]);
  });
});
