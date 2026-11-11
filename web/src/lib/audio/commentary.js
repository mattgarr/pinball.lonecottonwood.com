// The commentary level: one tap on the host page sets how much talking the garage gets. It writes the
// fine-grained audio settings (the per-topic toggles, the booth's on/off, frequency, bit length and
// extra bits); any manual tweak afterwards shows as "Custom". Pure (tested in commentary.test.js).
export const LEVEL_IDS = ['full', 'chill', 'announcer', 'sfx'];
export const LEVEL_NAMES = { full: 'Full booth', chill: 'Chill booth', announcer: 'Announcer only', sfx: 'Sound effects only', custom: 'Custom' };
// Button labels (short enough for two across a phone).
export const LEVEL_SHORT = { full: 'Full booth', chill: 'Chill booth', announcer: 'Announcer', sfx: 'Effects only' };
export const LEVEL_NOTES = {
  full: 'Two hosts + the announcer, booth every 6-8 min, plus a bit after big moments.',
  chill: 'Two hosts about half as often, shorter bits, nothing extra after big moments; announcer as usual.',
  announcer: 'One voice: countdowns, records, welcomes, winners. No booth.',
  sfx: 'No voices. Chimes, boops, fanfares and music stay.',
  custom: 'Set by hand below.',
};
const SAY_ALL = { sayClock: true, sayRecords: true, sayJoins: true, sayReveal: true };
export const LEVEL_PRESETS = {
  full: { voiceOn: true, ...SAY_ALL, boothOn: true, boothFreq: 'normal', boothShort: false, boothExtras: true },
  chill: { voiceOn: true, ...SAY_ALL, boothOn: true, boothFreq: 'less', boothShort: true, boothExtras: false },
  announcer: { voiceOn: true, ...SAY_ALL, boothOn: false },
  sfx: { voiceOn: false }, // keeps the rest, so going back up restores it
};

export function applyLevel(settings, level) {
  const p = LEVEL_PRESETS[level];
  return p ? { ...settings, ...p } : settings;
}

// Which level the settings are at ('custom' if hand-tuned).
export function levelOf(s = {}) {
  const on = k => s[k] !== false;
  if (s.voiceOn === false) return 'sfx';
  const allSay = ['sayClock', 'sayRecords', 'sayJoins', 'sayReveal'].every(on);
  if (!allSay) return 'custom';
  if (s.boothOn === false) return 'announcer';
  const freq = s.boothFreq || 'normal', short = !!s.boothShort, extras = s.boothExtras !== false;
  if (freq === 'normal' && !short && extras) return 'full';
  if (freq === 'less' && short && !extras) return 'chill';
  return 'custom';
}

// Lower = quieter. Going down cuts off a booth bit (or every voice) that's playing.
export const RANK = { sfx: 0, announcer: 1, chill: 2, full: 3, custom: 2 };
export const quieter = (from, to) => RANK[to] < RANK[from];
