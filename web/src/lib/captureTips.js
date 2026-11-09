import { machineSlug } from './machineArt.js';
// How to point the phone at each machine's score display. Shown in the scanner and in host Test & calibrate.
// shape = the on-screen box: 'tall' (whole backglass) or 'wide' (one display panel / screen).
const BY_SLUG = {
  centaur: {
    shape: 'tall',
    aim: 'Fit all 4 scores in the box.',
    note: 'Displays flip to HIGH SCORE TO DATE. Keep holding: the scan ignores it.',
  },
  fathom: {
    shape: 'tall',
    aim: 'Fit all 4 scores in the box.',
    note: 'Displays flash to the high score. Hold till the scan ends.',
  },
  whirlwind: {
    shape: 'wide',
    aim: 'Fill the box with the score panel.',
    note: 'Display cycles after a game. Scan right away.',
  },
  'white-water': {
    shape: 'wide',
    aim: 'Fill the box with the orange screen.',
    note: 'Scores show a few seconds, then the attract show. Scan right away.',
  },
  'cactus-canyon': {
    shape: 'wide',
    aim: 'Fill the box with the orange screen.',
    note: 'Scores show a few seconds, then the attract show. Scan right away.',
  },
  'dungeons-dragons': {
    shape: 'wide',
    aim: 'Fill the box with the score screen.',
    note: 'Glare? Tilt the phone a little.',
  },
};

const BY_TYPE = {
  '7-segment': BY_SLUG.centaur,
  alphanumeric: BY_SLUG.whirlwind,
  'dot-matrix': BY_SLUG['white-water'],
  'modern-lcd': BY_SLUG['dungeons-dragons'],
};

const slugOf = name => machineSlug(name || '');

export function captureTips(machine) {
  return BY_SLUG[slugOf(machine?.name)] || BY_TYPE[machine?.display_type] || { shape: 'wide', aim: 'Fill the box with the scores.', note: '' };
}

export const GENERAL_TIPS = [
  'Scan right after the game, while scores show.',
  'Get close, but keep all scores in the box.',
  'Tilt slightly while scanning to dodge glare.',
  'No flash. Room lights off is best.',
];
