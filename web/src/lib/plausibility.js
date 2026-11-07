// "Does this number look like a real game on this machine?" — a soft check that catches the
// classic fat-finger typos on 8–9 digit scores (a missing or extra zero, a stray digit at the
// end). It never blocks: the UI shows a friendly "double-check?" and the player decides.
import { machineSlug } from './machineArt.js';
import { fmt, fmtShort } from './scoring.js';

// Rough real-world ranges for a party crowd: `min` ≈ a rough beginner game,
// `max` ≈ a monster game nobody at a house party should beat.
export const RANGES = {
  'centaur':          { min: 20_000,    max: 3_000_000 },
  'fathom':           { min: 20_000,    max: 3_000_000 },
  'whirlwind':        { min: 100_000,   max: 15_000_000 },
  'white-water':      { min: 2_000_000, max: 1_500_000_000 },
  'cactus-canyon':    { min: 2_000_000, max: 2_000_000_000 },
  'dungeons-dragons': { min: 500_000,   max: 2_000_000_000 },
};
const DEFAULT_RANGE = { min: 1_000, max: 5_000_000_000 };

export const MAX_SCORE = 99_999_999_999; // what the server accepts (11 digits)

export function rangeFor(machine) {
  return (machine && RANGES[machineSlug(machine.name)]) || DEFAULT_RANGE;
}

const median = arr => {
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// "2.53 million" — reading the size out loud is the fastest way to spot a missing zero.
export function sayNumber(n) {
  const v = Number(n) || 0;
  const sig = x => Number(x.toPrecision(3)).toString();
  if (v >= 1e9) return `${sig(v / 1e9)} billion`;
  if (v >= 1e6) return `${sig(v / 1e6)} million`;
  if (v >= 1e3) return `${sig(v / 1e3)} thousand`;
  return String(v);
}

/**
 * Returns a list of warnings (empty = looks fine). Each: { kind, title, detail }.
 *   value         the score being entered
 *   machine       machine row ({ name, ... })
 *   machineScores live (non-voided) score rows for this machine
 */
export function checkScore(value, machine, machineScores = []) {
  const out = [];
  const v = Number(value);
  if (!v || v <= 0) return out;
  const name = machine?.name ?? 'this machine';
  const { min, max } = rangeFor(machine);
  const values = machineScores.filter(s => !s.voided).map(s => Number(s.value));
  const record = values.length ? Math.max(...values) : null;

  if (record && v > record * 5) {
    const x = Math.round(v / record);
    out.push({
      kind: 'record',
      title: `That's ${x}× the record!`,
      detail: `Tonight's best on ${name} is ${fmt(record)}. Double-check the zeros?`,
    });
  } else if (v > max) {
    out.push({
      kind: 'high',
      title: 'That would be a monster game',
      detail: `Over ${fmtShort(max)} on ${name} is rare. Extra zero?`,
    });
  }

  if (v < min) {
    out.push({
      kind: 'low',
      title: `Low for ${name}`,
      detail: `Most games here are over ${fmtShort(min)}. Missing a zero?`,
    });
  } else if (values.length >= 5 && v < median(values) / 30) {
    out.push({
      kind: 'low',
      title: 'Way below everyone else',
      detail: `Typical tonight is ~${fmtShort(median(values))}. Missing a zero?`,
    });
  }

  if (v % 10 !== 0) {
    out.push({
      kind: 'digit',
      title: 'Ends in a non-zero digit',
      detail: 'Pinball scores almost always end in 0. Stray extra digit?',
    });
  }
  return out;
}

// Would this value take 1st on the machine? (`othersBest` = best score by anyone else.)
export function crownInfo(value, playerId, machineScores = []) {
  let othersBest = null;
  for (const s of machineScores) {
    if (s.voided || s.player_id === playerId) continue;
    if (othersBest == null || s.value > othersBest) othersBest = Number(s.value);
  }
  const claimedTop = Number(value) > 0 && (othersBest == null || Number(value) > othersBest);
  return { claimedTop, othersBest, contested: claimedTop && othersBest != null };
}
