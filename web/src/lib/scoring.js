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
  // Wall of Shame: lowest ratings. It skips only the top 3 (not the whole Top Players board)
  // so it fills up early in the night too.
  const podium = new Set(eligible.slice(0, 3).map(st => st.player.id));
  const bottomPlayers = eligible
    .filter(st => !podium.has(st.player.id))
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

// Prizes (12): Grand Champion, 2nd, 3rd, a champion for each machine, The Grinder, The Big Whiff, The Match.
// One prize per person: someone who qualifies for several keeps the biggest, and each other prize goes to
// the next person in line for it. "Biggest" follows PRIZE_ORDER. Set ONE_PRIZE_EACH = false to allow doubles.
export const ONE_PRIZE_EACH = true;
export const PRIZE_ORDER = ['Grand Champion', '2nd Place', '3rd Place', 'machine champions', 'The Grinder', 'The Big Whiff', 'The Match'];

export function computeAwards({ machines = [], players = [], scores = [], standings, matchDigits = null }) {
  if (!standings) return {};
  const live = scores.filter(s => !s.voided);
  const playerById = new Map(players.map(p => [p.id, p]));
  const machineById = new Map(machines.map(m => [m.id, m]));
  const all = [...standings.stats.values()];

  const taken = new Set();
  const free = p => !!p && !(ONE_PRIZE_EACH && taken.has(p.id));
  const claim = (x, p) => { if (x && p) taken.add(p.id); return x ?? null; };

  // Grand Champion, 2nd and 3rd: the best overall ratings (2+ machines played).
  const nextRanked = () => { const st = standings.ranked.find(x => free(x.player)); return claim(st, st?.player); };
  const champion = nextRanked();
  const second = nextRanked();
  const third = nextRanked();

  // Machine champions: the top score on each machine (next in line if the top scorer already has a prize).
  const machineChamps = [];
  for (const m of standings.machines) {
    const row = m.rows.find(r => free(playerById.get(r.playerId)));
    if (!row) { machineChamps.push({ machine: m.machine, player: null }); continue; }
    const player = playerById.get(row.playerId);
    claim(row, player);
    machineChamps.push({ machine: m.machine, player, score: row.best, rank: row.rank, topScore: m.rows[0]?.best ?? null });
  }

  // The Grinder: most games logged.
  const grinderSt = all.filter(st => st.plays > 0 && free(st.player))
    .sort((a, b) => b.plays - a.plays || a.player.id - b.player.id)[0];
  const grinder = claim(grinderSt ? { player: grinderSt.player, plays: grinderSt.plays } : null, grinderSt?.player);

  // The Big Whiff: lowest overall rating (2+ machines played).
  const whiffSt = [...standings.ranked].filter(st => free(st.player))
    .sort((a, b) => a.rating - b.rating || b.machinesPlayed - a.machinesPlayed)[0];
  const bigWhiff = claim(whiffSt ? { player: whiffSt.player, rating: whiffSt.rating, machinesPlayed: whiffSt.machinesPlayed, worst: whiffSt.worst } : null, whiffSt?.player);

  // The Match: the host draws 00–99; the score whose last two digits are closest wins.
  let theMatch = null;
  if (matchDigits != null && matchDigits !== '') {
    const draw = ((Number(matchDigits) % 100) + 100) % 100;
    const dist = v => { const d = Math.abs((v % 100) - draw); return Math.min(d, 100 - d); };
    const best = [...live].sort((a, b) => dist(a.value) - dist(b.value) || a.id - b.id)
      .find(s => free(playerById.get(s.player_id)));
    if (best) theMatch = claim({ player: playerById.get(best.player_id), value: best.value, machine: machineById.get(best.machine_id), drawn: draw, distance: dist(best.value) }, playerById.get(best.player_id));
  }

  return { champion, second, third, machineChamps, grinder, bigWhiff, theMatch };
}

// Prize names a player is holding right now (for the ME tab and the results email).
export function prizesFor(awards, playerId) {
  const out = [];
  if (awards.champion?.player.id === playerId) out.push('Grand Champion');
  if (awards.second?.player.id === playerId) out.push('2nd Place');
  if (awards.third?.player.id === playerId) out.push('3rd Place');
  for (const c of awards.machineChamps ?? []) if (c.player?.id === playerId) out.push(`${c.machine.name} Champion`);
  if (awards.grinder?.player.id === playerId) out.push('The Grinder');
  if (awards.bigWhiff?.player.id === playerId) out.push('The Big Whiff');
  if (awards.theMatch?.player?.id === playerId) out.push('The Match');
  return out;
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
