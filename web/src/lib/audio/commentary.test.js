import { describe, it, expect } from 'vitest';
import { LEVEL_IDS, applyLevel, levelOf, quieter } from './commentary.js';
import { AUDIO_DEFAULTS } from './tv.js';

describe('commentary level', () => {
  it('the defaults are Full booth with the Valley girl + Fun-center DJ duo', () => {
    expect(levelOf(AUDIO_DEFAULTS)).toBe('full');
    expect([AUDIO_DEFAULTS.boothA, AUDIO_DEFAULTS.boothB]).toEqual(['valley', 'dj']);
  });
  it('each level sets the fine-grained settings, and reads back as itself', () => {
    let s = { ...AUDIO_DEFAULTS };
    for (const l of [...LEVEL_IDS, 'full', 'announcer', 'chill', 'sfx', 'full']) {
      s = applyLevel(s, l);
      expect(levelOf(s)).toBe(l);
    }
  });
  it('sound effects only, then back up, restores the voices as they were', () => {
    const s = applyLevel(applyLevel(AUDIO_DEFAULTS, 'chill'), 'sfx');
    expect(s.voiceOn).toBe(false);
    expect(levelOf(applyLevel(s, 'chill'))).toBe('chill');
  });
  it('a manual tweak shows as Custom', () => {
    expect(levelOf({ ...applyLevel(AUDIO_DEFAULTS, 'full'), boothFreq: 'more' })).toBe('custom');
    expect(levelOf({ ...applyLevel(AUDIO_DEFAULTS, 'announcer'), sayJoins: false })).toBe('custom');
    expect(levelOf({ ...applyLevel(AUDIO_DEFAULTS, 'chill'), boothExtras: true })).toBe('custom');
  });
  it('going down is quieter', () => {
    expect(quieter('full', 'chill')).toBe(true);
    expect(quieter('chill', 'announcer')).toBe(true);
    expect(quieter('announcer', 'full')).toBe(false);
    expect(quieter('full', 'sfx')).toBe(true);
  });
});

describe('who speaks', () => {
  it('the announcer voice defaults to Tiffani', async () => {
    const { DEFAULT_PACK } = await import('./voice.js');
    expect(DEFAULT_PACK).toBe('valley');
    expect(AUDIO_DEFAULTS.pack).toBe('valley');
  });
});
