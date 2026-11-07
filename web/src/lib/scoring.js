// Standings and prizes, computed in the browser from the raw scores.
//
// Raw scores aren't comparable across machines (a great Fathom game is ~3M; Cactus Canyon
// runs 100M+), so nothing here adds raw scores together. Instead:
//   STANDING on a machine = where your best score places among everyone who played it:
//     round(100 * (N - rank + 1) / N)   → 1st = 100, last ≈ 100/N, ties share a rank.
//   RATING = the plain average of your standings across the machines you played.
//     You need MIN_TABLES machines to get a rating (and appear on the boards).

export const MIN_TABLES = 2;

function rankRows(rows) {
  // rows: [{ playerId, best }] → sorted, with competition rank + standing
  rows.sort((a, b) => b.best - a.best);
  const N = rows.length;
  let i = 0;
  while (i < N) {
    let j = i;
    while (j < N && rows[j].best === rows[i].best) j++;
    const rank = i + 1;
    const standing = Math.round((100 * (N - rank + 1)) / N);
    for (let k = i; k < j; k++) Object.assign(rows[k], { rank, standing, N });
    i = j;
  }
  return rows;
}

export function computeStandings({ machines = [], players = [], scores = [] }) {
  const live = scores.filter(s => !s.voided);
  const playerById = new Map(players.map(p => [p.id, p]));

  const stats = new Map(players.map(p => [p.id, {
    player: p, plays: 0, machinesPlayed: 0, standingSum: 0,
    perMachine: {}, crowns: 0, worst: null, best: null, rating: null, avg: null, rank: null,
  }]));

  // best score per player per machine
  const bestBy = new Map(); // mid -> Map(pid -> best)
  for (const s of live) {
    const st = stats.get(s.player_id);
    if (!st) continue;
    st.plays++;
    if (!bestBy.has(s.machine_id)) bestBy.set(s.machine_id, new Map());
    const m = bestBy.get(s.machine_id);
    if (!m.has(s.player_id) || s.value > m.get(s.player_id)) m.set(s.player_id, s.value);
  }

  const machinesOut = machines.map(m => {
    const rows = rankRows([...(bestBy.get(m.id) ?? new Map())].map(([playerId, best]) => ({ playerId, best })));
    for (const r of rows) {
      const st = stats.get(r.playerId);
      st.perMachine[m.id] = { best: r.best, rank: r.rank, N: r.N, standing: r.standing };
      st.machinesPlayed++;
      st.standingSum += r.standing;
      if (r.rank === 1) st.crowns++;
      if (!st.worst || r.standing < st.worst.standing) st.worst = { machineId: m.id, machineName: m.name, rank: r.rank, N: r.N, standing: r.standing };
      if (!st.best || r.standing > st.best.standing) st.best = { machineId: m.id, machineName: m.name, rank: r.rank, N: r.N, standing: r.standing };
    }
    const top = rows.slice(0, 10).map(r => ({ player: playerById.get(r.playerId), score: r.best, rank: r.rank }));
    return { machine: m, N: rows.length, top, rows, champion: top[0] ?? null };
  });

  for (const st of stats.values()) {
    if (st.machinesPlayed) st.avg = Math.round(st.standingSum / st.machinesPlayed);
    if (st.machinesPlayed >= MIN_TABLES) st.rating = st.avg;
  }

  const eligible = [...stats.values()]
    .filter(st => st.rating != null)
    .sort((a, b) => b.rating - a.rating || b.crowns - a.crowns || b.machinesPlayed - a.machinesPlayed || a.player.id - b.player.id);
  eligible.forEach((st, i) => {
    st.rank = i > 0 && st.rating === eligible[i - 1].rating ? eligible[i - 1].rank : i + 1;
  });

  const topPlayers = eligible.slice(0, 10);
  const topIds = new Set(topPlayers.map(st => st.player.id));
  // Wall of Shame: lowest ratings, never overlapping the Top Players board.
  const bottomPlayers = eligible
    .filter(st => !topIds.has(st.player.id))
    .sort((a, b) => a.rating - b.rating || b.machinesPlayed - a.machinesPlayed)
    .slice(0, 5);

  return {
    machines: machinesOut,
    stats,            // Map(playerId -> stats)
    ranked: eligible, // everyone with a rating, best first
    topPlayers,
    bottomPlayers,
    meta: { totalScores: live.length, totalPlayers: players.length, rankedPlayers: eligible.length },
  };
}

export function computeAwards({ machines = [], players = [], scores = [], standings, matchDigits = null }) {
  if (!standings) return {};
  const live = scores.filter(s => !s.voided);
  const playerById = new Map(players.map(p => [p.id, p]));
  const machineById = new Map(machines.map(m => [m.id, m]));
  const topByMachine = new Map(standings.machines.map(m => [m.machine.id, m.rows[0]?.best ?? 0]));
  const all = [...standings.stats.values()];

  // Overall Champion: highest rating.
  const champion = standings.ranked[0] ?? null;

  // Beginner's Luck: the first-timer whose single game came closest to that machine's best.
  let beginnersLuck = null;
  for (const s of live) {
    const p = playerById.get(s.player_id);
    if (!p?.first_timer) continue;
    const top = topByMachine.get(s.machine_id);
    const pct = top > 0 ? s.value / top : 1;
    if (!beginnersLuck || pct > beginnersLuck.pctRaw) {
      beginnersLuck = { player: p, value: s.value, machine: machineById.get(s.machine_id), pctRaw: pct, pct: Math.round(pct * 100) };
    }
  }

  // The Grinder: most games logged.
  const grinderSt = all.filter(st => st.plays > 0).sort((a, b) => b.plays - a.plays || a.player.id - b.player.id)[0];
  const grinder = grinderSt ? { player: grinderSt.player, plays: grinderSt.plays } : null;

  // Globetrotters: played every machine.
  const globetrotters = machines.length
    ? all.filter(st => st.machinesPlayed === machines.length).map(st => st.player)
    : [];

  // The Big Whiff: lowest rating (from the Wall of Shame, so never a Top Player).
  const whiffSt = standings.bottomPlayers[0] ?? null;
  const bigWhiff = whiffSt ? { player: whiffSt.player, rating: whiffSt.rating, machinesPlayed: whiffSt.machinesPlayed, worst: whiffSt.worst } : null;

  // Heartbreakers: the runner-up on each machine.
  const heartbreakers = [];
  for (const m of standings.machines) {
    const second = m.rows.find(r => r.rank > 1);
    if (second) heartbreakers.push({ player: playerById.get(second.playerId), machine: m.machine, score: second.best });
  }

  // The Match: host draws 00–99; the score whose last two digits are closest wins.
  let theMatch = null;
  if (matchDigits != null && matchDigits !== '') {
    const draw = ((Number(matchDigits) % 100) + 100) % 100;
    for (const s of [...live].sort((a, b) => a.id - b.id)) {
      const last2 = s.value % 100;
      const d = Math.min(Math.abs(last2 - draw), 100 - Math.abs(last2 - draw));
      if (!theMatch || d < theMatch.distance) {
        theMatch = { player: playerById.get(s.player_id), value: s.value, machine: machineById.get(s.machine_id), drawn: draw, distance: d };
      }
    }
  }

  return { champion, beginnersLuck, grinder, globetrotters, bigWhiff, heartbreakers, theMatch };
}

export const fmt = n => Number(n).toLocaleString();
export const fmtShort = n => {
  const v = Number(n);
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
};
export const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
