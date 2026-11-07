import { db } from './db.js';
import { config } from './config.js';

// Compute live standings from non-voided scores.
// Per-machine: each team's best score ranks it; placement points via config.pointsTable.
// Ties split the average of tied places.
// Participation: +config.participationPointsPerPlay per logged play (per player),
// soft-capped at config.participationCap counted plays per player, summed to the team.
//
// Returns a rich payload for the TV dashboard:
//   teams[]       — sorted by total, each with rank, members, placement/participation,
//                   and perMachine[mid] = { best, rank, points }
//   machines[]    — per machine: champion (individual high) + leading team
//   topPlayers[]  — individual leaderboard by personal total (sum of best-per-machine)
export function computeStandings() {
  const teams = db.prepare(`SELECT id, name, color FROM teams ORDER BY id`).all();
  const machines = db.prepare(`
    SELECT id, name, year, manufacturer FROM machines WHERE active = 1 ORDER BY sort_order, id
  `).all();

  const memberCounts = db.prepare(`SELECT team_id, COUNT(*) AS n FROM players GROUP BY team_id`).all();
  const memberMap = new Map(memberCounts.map(r => [r.team_id, r.n]));

  const teamAgg = new Map(teams.map(t => [t.id, {
    teamId: t.id, teamName: t.name, color: t.color,
    members: memberMap.get(t.id) || 0,
    standingSum: 0, machinesPlayed: 0,
    perMachine: {}, // mid -> { best, rank }
  }]));

  // Per-machine best per team
  const bestPerTeamPerMachine = db.prepare(`
    SELECT s.machine_id, p.team_id, MAX(s.value) AS best
    FROM scores s
    JOIN players p ON p.id = s.player_id
    WHERE s.voided = 0
    GROUP BY s.machine_id, p.team_id
  `).all();

  const byMachine = new Map(); // machine_id -> [{teamId, best}]
  for (const row of bestPerTeamPerMachine) {
    if (!byMachine.has(row.machine_id)) byMachine.set(row.machine_id, []);
    byMachine.get(row.machine_id).push({ teamId: row.team_id, best: row.best });
  }

  // UNIFIED MODEL: a team's "standing" on a machine = how its best score places among the
  // teams that played it (1st = 100, last ≈ 100/N). A team's RATING = the average of those
  // standings across the machines it has played — exactly parallel to a player's rating, just
  // with the team's best score standing in for the team. (Volume is rewarded via the prizes.)
  for (const m of machines) {
    const rows = (byMachine.get(m.id) ?? []).slice().sort((a, b) => b.best - a.best);
    const N = rows.length;
    let i = 0;
    while (i < N) {
      let j = i;
      while (j < N && rows[j].best === rows[i].best) j++;
      const rank = i + 1; // tied teams share the top of their band
      const standing = Math.round(100 * (N - rank + 1) / N);
      for (let k = i; k < j; k++) {
        const agg = teamAgg.get(rows[k].teamId);
        if (agg) {
          agg.standingSum += standing;
          agg.machinesPlayed += 1;
          agg.perMachine[m.id] = { best: rows[k].best, rank };
        }
      }
      i = j;
    }
  }

  // Individual machine champions (highest single score per machine)
  const champRows = db.prepare(`
    SELECT s.machine_id, s.player_id, p.display_name, p.emoji, p.avatar, p.team_id,
           t.name AS team_name, t.color AS team_color, s.value
    FROM scores s
    JOIN players p ON p.id = s.player_id
    JOIN teams t ON t.id = p.team_id
    WHERE s.voided = 0
      AND s.value = (
        SELECT MAX(s2.value) FROM scores s2
        WHERE s2.machine_id = s.machine_id AND s2.voided = 0
      )
    GROUP BY s.machine_id
  `).all();
  const champByMachine = new Map(champRows.map(r => [r.machine_id, r]));

  const teamsOut = [...teamAgg.values()]
    .map(t => ({ ...t, rating: t.machinesPlayed ? Math.round(t.standingSum / t.machinesPlayed) : 0 }))
    .sort((a, b) => b.rating - a.rating || b.machinesPlayed - a.machinesPlayed)
    .map((t, idx) => ({ ...t, rank: idx + 1 }));

  // Per-machine player leaderboard (each player's best on that machine, top 5).
  const topPerMachineStmt = db.prepare(`
    SELECT MAX(s.value) AS value, p.id AS player_id, p.display_name, p.emoji, p.avatar,
           t.name AS team_name, t.color AS team_color
    FROM scores s
    JOIN players p ON p.id = s.player_id
    JOIN teams t ON t.id = p.team_id
    WHERE s.machine_id = ? AND s.voided = 0
    GROUP BY p.id
    ORDER BY value DESC
    LIMIT 10
  `);

  const machinesOut = machines.map(m => {
    const c = champByMachine.get(m.id);
    const leaderRows = (byMachine.get(m.id) ?? []).slice().sort((a, b) => b.best - a.best);
    const top = topPerMachineStmt.all(m.id).map(r => ({
      playerId: r.player_id, displayName: r.display_name, emoji: r.emoji, avatar: r.avatar,
      teamName: r.team_name, teamColor: r.team_color, score: r.value,
    }));
    return {
      machineId: m.id,
      machineName: m.name,
      manufacturer: m.manufacturer,
      year: m.year,
      champion: c ? {
        playerId: c.player_id, displayName: c.display_name, emoji: c.emoji, avatar: c.avatar,
        teamName: c.team_name, teamColor: c.team_color, score: c.value,
      } : null,
      leader: leaderRows[0] ? { teamId: leaderRows[0].teamId, score: leaderRows[0].best } : null,
      top,
    };
  });

  // ---- individual leaderboard --------------------------------------------
  const crownCount = new Map();
  for (const c of champRows) crownCount.set(c.player_id, (crownCount.get(c.player_id) || 0) + 1);

  const playerRows = db.prepare(`
    SELECT p.id AS player_id, p.display_name, p.emoji, p.avatar, p.first_timer,
           t.name AS team_name, t.color AS team_color,
           COUNT(CASE WHEN s.voided = 0 THEN s.id END) AS plays,
           COUNT(DISTINCT CASE WHEN s.voided = 0 THEN s.machine_id END) AS machines_played
    FROM players p
    JOIN teams t ON t.id = p.team_id
    LEFT JOIN scores s ON s.player_id = p.id
    GROUP BY p.id
  `).all();

  // Individual scoring is NORMALIZED by where you stand on each machine's leaderboard —
  // NOT a raw sum. Raw scores aren't comparable across machines (a great Fathom game is
  // ~3M; Cactus Canyon / White Water run 100M–300M), so summing them would let the
  // high-magnitude machines dominate entirely. Instead, on each machine we rank players by
  // best score and award standing points: top = 100, scaling down to ~100/N for last place
  // (competition ranking, so ties share a rank). A player's score is the sum of their
  // standing points across the machines they played — rewarding both skill and breadth.
  const bestPerPlayerMachine = db.prepare(`
    SELECT s.player_id, s.machine_id, MAX(s.value) AS best
    FROM scores s WHERE s.voided = 0
    GROUP BY s.player_id, s.machine_id
  `).all();

  const machineNameById = new Map(machines.map(m => [m.id, m.name]));
  const byMachinePlayers = new Map(); // machine_id -> [{playerId, best}]
  for (const r of bestPerPlayerMachine) {
    if (!byMachinePlayers.has(r.machine_id)) byMachinePlayers.set(r.machine_id, []);
    byMachinePlayers.get(r.machine_id).push({ playerId: r.player_id, best: r.best });
  }

  const standingPoints = new Map();         // playerId -> total normalized points
  const bestMachineStanding = new Map();    // playerId -> { machineId, rank, points } (best result)
  const worstMachineStanding = new Map();   // playerId -> { machineName, rank, N } (worst result)
  for (const [mid, rows] of byMachinePlayers) {
    rows.sort((a, b) => b.best - a.best);
    const N = rows.length;
    let i = 0;
    while (i < N) {
      let j = i;
      while (j < N && rows[j].best === rows[i].best) j++;
      const rank = i + 1; // tied band shares the top rank of the band
      const points = Math.round(100 * (N - rank + 1) / N); // 1st -> 100, last -> ~100/N
      for (let k = i; k < j; k++) {
        const pid = rows[k].playerId;
        standingPoints.set(pid, (standingPoints.get(pid) || 0) + points);
        const prevBest = bestMachineStanding.get(pid);
        if (!prevBest || points > prevBest.points) {
          bestMachineStanding.set(pid, { machineId: mid, rank, points });
        }
        const prevWorst = worstMachineStanding.get(pid);
        if (!prevWorst || points < prevWorst.points) {
          worstMachineStanding.set(pid, { machineName: machineNameById.get(mid), rank, N });
        }
      }
      i = j;
    }
  }

  const playersScored = playerRows
    .filter(p => p.plays > 0)
    .map(p => {
      const points = standingPoints.get(p.player_id) || 0;
      const mp = p.machines_played;
      return {
        playerId: p.player_id, displayName: p.display_name, emoji: p.emoji, avatar: p.avatar,
        firstTimer: !!p.first_timer,
        teamName: p.team_name, teamColor: p.team_color,
        points,
        avgStanding: mp ? Math.round(points / mp) : 0,
        plays: p.plays, machinesPlayed: mp,
        crowns: crownCount.get(p.player_id) || 0,
        worst: worstMachineStanding.get(p.player_id) || null,
      };
    });

  // Both leaderboards rank by the SAME metric, so a player can never be high on one and low
  // on the other. That metric is a "rating": a weighted average of their per-machine
  // standings, regularized toward a neutral middle (50) by RATING_PSEUDO pseudo-tables.
  //   rating = (sumStanding + PSEUDO*PRIOR) / (machinesPlayed + PSEUDO)
  // This (a) judges you only on tables you played, (b) rewards breadth — sustaining a high
  // standing across six tables rates higher than across two — and (c) pulls tiny samples
  // toward the middle so one lucky or unlucky game can't top or bottom the board.
  const RATING_PRIOR = 50;   // neutral middle standing
  const RATING_PSEUDO = 2;   // pseudo-tables of "average" mixed into everyone's rating
  const MIN_TABLES = 2;      // must have played at least this many tables for either board
  for (const p of playersScored) {
    p.rating = Math.round((p.points + RATING_PSEUDO * RATING_PRIOR) / (p.machinesPlayed + RATING_PSEUDO));
  }
  const eligible = playersScored.filter(p => p.machinesPlayed >= MIN_TABLES);

  const topPlayers = [...eligible]
    .sort((a, b) => b.rating - a.rating || b.crowns - a.crowns || b.machinesPlayed - a.machinesPlayed)
    .slice(0, 8);

  // Wall of Shame: the lowest ratings — explicitly excluding anyone already on Top Players,
  // so the two boards are guaranteed mutually exclusive even in a tiny party.
  const topIds = new Set(topPlayers.map(p => p.playerId));
  const bottomPlayers = eligible
    .filter(p => !topIds.has(p.playerId))
    .sort((a, b) => a.rating - b.rating || b.machinesPlayed - a.machinesPlayed)
    .slice(0, 5);

  const totals = db.prepare(`
    SELECT COUNT(*) AS scores FROM scores WHERE voided = 0
  `).get();
  const playerCount = db.prepare(`SELECT COUNT(*) AS n FROM players`).get().n;

  return {
    teams: teamsOut,
    machines: machinesOut,
    topPlayers,
    bottomPlayers,
    meta: { totalScores: totals.scores, totalPlayers: playerCount },
  };
}
