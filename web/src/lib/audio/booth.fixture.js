// A realistic slice of party night for the booth's tests and samples: 14 players, six machines,
// 70 minutes in, some good games, some rough ones.
export const T0 = Date.parse('2026-11-14T03:30:00Z'); // 7:30 PM Pacific
const MACHINES = [
  [1, 'Fathom'], [2, 'Centaur'], [3, 'Whirlwind'], [4, 'Whitewater'], [5, 'Cactus Canyon'], [6, 'Dungeons & Dragons'],
].map(([id, name], i) => ({ id, name, manufacturer: 'Bally', year: 1990, sort_order: i + 1, active: true }));
const NAMES = ['Big Dave', 'Stacia 🎱', 'Theo', 'Matt', 'Priya', 'Tilt Tom', 'Grandpa Joe', 'Mia (age 9)', 'Rosa', 'Kenji', 'Flipper Fran', 'Sam', 'Lena', 'Omar'];
// Typical scores per machine (Fathom ~3M, Cactus Canyon ~100M…).
const BASE = { 1: 3_000_000, 2: 1_400_000, 3: 6_000_000, 4: 12_000_000, 5: 90_000_000, 6: 45_000_000 };

export function partyNight({ minutesIn = 70, freePlayBefore = 30 } = {}) {
  const players = NAMES.map((n, i) => ({ id: i + 1, display_name: n, color: '#ff00aa', emoji: '🎯' }));
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const skill = id => [1.6, 1.3, 1.1, 1.2, 1.0, 0.9, 0.7, 0.6, 1.0, 1.05, 1.15, 0.85, 0.95, 0.4][id - 1];
  const scores = [];
  let id = 1;
  for (let m = -freePlayBefore; m < minutesIn; m += 1) {
    for (const p of players) {
      if (rnd() > 0.09) continue;
      const mid = 1 + Math.floor(rnd() * 6);
      const value = Math.round((BASE[mid] * skill(p.id) * (0.3 + rnd() * 1.4)) / 10) * 10;
      scores.push({ id: id++, player_id: p.id, machine_id: mid, value, voided: false, free_play: m < 0, created_at: new Date(T0 - (minutesIn - m) * 60000).toISOString() });
    }
  }
  // A few stories: Big Dave just smashed Fathom, Omar's rough night, Stacia on a heater.
  const ago = mins => new Date(T0 - mins * 60000).toISOString();
  scores.push({ id: id++, player_id: 1, machine_id: 1, value: 9_215_440, voided: false, free_play: false, created_at: ago(2) });
  scores.push({ id: id++, player_id: 14, machine_id: 5, value: 1_210_000, voided: false, free_play: false, created_at: ago(4) });
  scores.push({ id: id++, player_id: 2, machine_id: 3, value: 14_800_000, voided: false, free_play: false, created_at: ago(6) });
  scores.push({ id: id++, player_id: 2, machine_id: 4, value: 31_000_000, voided: false, free_play: false, created_at: ago(11) });
  const party = { tourney_starts_at: new Date(T0 - minutesIn * 60000).toISOString(), tourney_ends_at: new Date(T0 + (180 - minutesIn) * 60000).toISOString() };
  return { machines: MACHINES, players, scores, party, now: T0 };
}
