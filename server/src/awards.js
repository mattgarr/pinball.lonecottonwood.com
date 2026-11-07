import { db } from './db.js';
import { computeStandings } from './standings.js';

// Auto-computed funny awards. Returns null entries when the data doesn't support an award.
//
// Normalization note: scores aren't comparable across machines (a great Fathom game is ~3M;
// Cactus Canyon / White Water run 100M–300M). So nothing here compares raw scores across
// machines:
//   - Big Whiff       -> the player with the WORST average per-machine standing (rank-based),
//                        counting only the tables they played (>= 2 of them). You have to have
//                        actually sucked at several tables, not just played one unlucky ball.
//   - Beginner's Luck -> the first-timer who got CLOSEST to a machine's best (% of its top)
//   - Grinder / Globetrotter -> play counts
//   - Heartbreaker    -> 2nd place per machine (placement, not raw score)
//   - The Match       -> last-two-digits raffle
export function computeAwards({ matchDigits = null } = {}) {
  const awards = {};

  // Per-machine top score, for normalizing cross-machine comparisons.
  const machineTopRows = db.prepare(`
    SELECT machine_id, MAX(value) AS top FROM scores WHERE voided = 0 GROUP BY machine_id
  `).all();
  const machineTop = new Map(machineTopRows.map(r => [r.machine_id, r.top]));
  const pctOfTop = (machineId, value) => {
    const top = machineTop.get(machineId);
    return top && top > 0 ? value / top : 1;
  };

  // All live scores with player/team/machine, used for the normalized single-score awards.
  const allScores = db.prepare(`
    SELECT s.value, s.machine_id, p.display_name, p.emoji, p.avatar, p.first_timer,
           t.name AS team_name, t.color AS team_color, m.name AS machine_name
    FROM scores s
    JOIN players p ON p.id = s.player_id
    JOIN teams t ON t.id = p.team_id
    JOIN machines m ON m.id = s.machine_id
    WHERE s.voided = 0
  `).all();

  // Big Whiff: the player with the worst AVERAGE standing across the tables they played
  // (>= 2 tables). Rank-based and magnitude-independent — derived from the same Wall of
  // Shame the TV shows.
  {
    const whiff = computeStandings().bottomPlayers?.[0];
    awards.bigWhiff = whiff ? {
      display_name: whiff.displayName, emoji: whiff.emoji, avatar: whiff.avatar,
      team_name: whiff.teamName, team_color: whiff.teamColor,
      rating: whiff.rating, avgStanding: whiff.avgStanding,
      machinesPlayed: whiff.machinesPlayed, worst: whiff.worst,
    } : null;
  }

  // Beginner's Luck: the first-timer who got CLOSEST to a machine's best (highest % of top),
  // not merely whoever happened to play the highest-magnitude machine.
  {
    let best = null, bestPct = -Infinity;
    for (const r of allScores) {
      if (!r.first_timer) continue;
      const pct = pctOfTop(r.machine_id, r.value);
      if (pct > bestPct) { bestPct = pct; best = r; }
    }
    awards.beginnersLuck = best ? {
      value: best.value, display_name: best.display_name, emoji: best.emoji, avatar: best.avatar,
      team_name: best.team_name, team_color: best.team_color, machine_name: best.machine_name,
      pct: Math.round(bestPct * 100),
    } : null;
  }

  // Grinder: most plays logged (count — magnitude-independent)
  awards.grinder = db.prepare(`
    SELECT p.display_name, p.emoji, p.avatar, t.name AS team_name, t.color AS team_color, COUNT(s.id) AS plays
    FROM players p
    JOIN scores s ON s.player_id = p.id AND s.voided = 0
    JOIN teams t ON t.id = p.team_id
    GROUP BY p.id
    ORDER BY plays DESC, p.id ASC LIMIT 1
  `).get() ?? null;

  // Team Workhorse: the team that logged the most games (count).
  awards.teamGrinder = db.prepare(`
    SELECT t.name AS team_name, t.color AS team_color, COUNT(s.id) AS plays
    FROM teams t
    JOIN players p ON p.team_id = t.id
    JOIN scores s ON s.player_id = p.id AND s.voided = 0
    GROUP BY t.id
    ORDER BY plays DESC, t.id ASC LIMIT 1
  `).get() ?? null;

  // Globetrotter: played all machines (count — magnitude-independent)
  const totalMachines = db.prepare(`SELECT COUNT(*) AS n FROM machines WHERE active = 1`).get().n;
  awards.globetrotters = db.prepare(`
    SELECT p.display_name, p.emoji, t.name AS team_name, t.color AS team_color,
           COUNT(DISTINCT s.machine_id) AS distinct_machines
    FROM players p
    JOIN scores s ON s.player_id = p.id AND s.voided = 0
    JOIN teams t ON t.id = p.team_id
    GROUP BY p.id
    HAVING distinct_machines = ?
    ORDER BY p.display_name
  `).all(totalMachines);

  // Heartbreaker: finished 2nd on a machine (placement — already normalized)
  awards.heartbreakers = [];
  const machines = db.prepare(`SELECT id, name FROM machines WHERE active = 1 ORDER BY sort_order, id`).all();
  for (const m of machines) {
    const teamBests = db.prepare(`
      SELECT p.team_id, MAX(s.value) AS best
      FROM scores s JOIN players p ON p.id = s.player_id
      WHERE s.machine_id = ? AND s.voided = 0
      GROUP BY p.team_id
      ORDER BY best DESC
    `).all(m.id);
    if (teamBests.length < 2) continue;
    const secondTeamId = teamBests[1].team_id;
    const secondScore = teamBests[1].best;
    const player = db.prepare(`
      SELECT p.display_name, p.emoji, t.name AS team_name, t.color AS team_color, s.value
      FROM scores s
      JOIN players p ON p.id = s.player_id
      JOIN teams t ON t.id = p.team_id
      WHERE s.machine_id = ? AND s.voided = 0 AND p.team_id = ? AND s.value = ?
      ORDER BY s.created_at ASC LIMIT 1
    `).get(m.id, secondTeamId, secondScore);
    if (player) awards.heartbreakers.push({ machine: m.name, ...player });
  }

  // The Match: host draws 00..90; closest score by last two digits wins (magnitude-independent).
  if (matchDigits != null) {
    const draw = ((Number(matchDigits) % 100) + 100) % 100;
    let best = null, bestDist = Infinity;
    for (const r of allScores) {
      const last2 = ((r.value % 100) + 100) % 100;
      const d = Math.min(Math.abs(last2 - draw), 100 - Math.abs(last2 - draw));
      if (d < bestDist) { bestDist = d; best = { ...r, drawn: draw, distance: d }; }
    }
    awards.theMatch = best ? {
      value: best.value, display_name: best.display_name, emoji: best.emoji, avatar: best.avatar,
      team_name: best.team_name, team_color: best.team_color, machine_name: best.machine_name,
      drawn: best.drawn, distance: best.distance,
    } : null;
  } else {
    awards.theMatch = null;
  }

  return awards;
}
