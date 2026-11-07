// How to point the phone at each machine's score display. Shown in the scanner and in host Test & calibrate.
// shape = the on-screen box: 'tall' (whole backglass) or 'wide' (one display panel / screen).
const BY_SLUG = {
  centaur: {
    shape: 'tall',
    aim: 'Frame the whole backglass so all four score displays are inside the box, about an arm\'s length away.',
    note: 'After a game the displays flip to HIGH SCORE TO DATE every few seconds. Keep holding: the scan catches both and ignores the high score.',
  },
  fathom: {
    shape: 'tall',
    aim: 'Frame the whole backglass so all four score displays are inside the box, about an arm\'s length away.',
    note: 'After a game the displays flash between your scores and the high score. Keep holding until the scan finishes.',
  },
  whirlwind: {
    shape: 'wide',
    aim: 'Fill the box with the score display panel just below the backglass.',
    note: 'The display cycles messages after a game. Scan right away while the scores are still up.',
  },
  'white-water': {
    shape: 'wide',
    aim: 'Fill the box with just the orange dot-matrix screen.',
    note: 'Final scores show for a few seconds after the game, then the attract show starts. Scan right away.',
  },
  'cactus-canyon': {
    shape: 'wide',
    aim: 'Fill the box with just the orange dot-matrix screen.',
    note: 'Final scores show for a few seconds after the game, then the attract show starts. Scan right away.',
  },
  'dungeons-dragons': {
    shape: 'wide',
    aim: 'Fill the box with just the score screen (the LCD in the backbox).',
    note: 'The bright screen reflects lights: tilt the phone a little if you see glare.',
  },
};

const BY_TYPE = {
  '7-segment': BY_SLUG.centaur,
  alphanumeric: BY_SLUG.whirlwind,
  'dot-matrix': BY_SLUG['white-water'],
  'modern-lcd': BY_SLUG['dungeons-dragons'],
};

const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function captureTips(machine) {
  return BY_SLUG[slugOf(machine?.name)] || BY_TYPE[machine?.display_type] || { shape: 'wide', aim: 'Fill the box with the score display.', note: '' };
}

export const GENERAL_TIPS = [
  'Scan right after the game ends, while the final scores are up.',
  'Hold about an arm\'s length away. Closer is better as long as the scores fit in the box.',
  'Tilt the phone slightly while it scans: it moves glare off the digits.',
  'No flash needed. The displays light themselves; room lights off is best.',
];
