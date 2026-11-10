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
  // Ranks follow exactly this order (rating, then crowns, then machines played), so the board, the
  // Ranks page, the emails and the prizes always agree on who is #1, #2 and #3: no shared ranks.
  eligible.forEach((st, i) => { st.rank = i + 1; });

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
    if (!row) { machineChamps.push({ machine: m.machine, player: null, noScores: !m.rows.length }); continue; }
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

  // The Match, like a real pinball Match: the app draws 00, 10, 20 … 90 at the start of the reveal and
  // compares it with the last two digits of every score (scores end in 0, so in practice the tens digit
  // decides). Everyone with a matching score is in the tie-break; if nobody matches exactly, the closest
  // scores are. The tie-break picks one player at random (a fixed shuffle of the draw, so every screen
  // agrees) and the TV shows it as a slot-machine spin through the tied players.
  let theMatch = null;
  if (matchDigits != null && matchDigits !== '') {
    const draw = Math.floor((((Number(matchDigits) % 100) + 100) % 100) / 10) * 10;
    const digits = v => v % 100;
    const dist = v => { const d = Math.abs(digits(v) - draw); return Math.min(d, 100 - d); };
    const shuffle = id => {
      let h = Math.imul(id ^ Math.imul(draw + 1, 0x9e3779b1), 0x85ebca6b);
      h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
      return h >>> 0;
    };
    // Each player's closest score (one entry per player, however many games they logged).
    const bestOf = new Map();
    for (const s of live) {
      const p = playerById.get(s.player_id);
      if (!free(p)) continue;
      const cur = bestOf.get(p.id);
      if (!cur || dist(s.value) < dist(cur.value)) bestOf.set(p.id, s);
    }
    const entries = [...bestOf.values()];
    if (entries.length) {
      const min = Math.min(...entries.map(s => dist(s.value)));
      const tied = entries.filter(s => dist(s.value) === min).sort((a, b) => shuffle(a.player_id) - shuffle(b.player_id));
      const win = tied[0];
      const others = entries.filter(s => dist(s.value) !== min).map(s => playerById.get(s.player_id))
        .sort((a, b) => shuffle(a.id) - shuffle(b.id));
      theMatch = claim({
        player: playerById.get(win.player_id), value: win.value, machine: machineById.get(win.machine_id),
        drawn: draw, distance: min, exact: min === 0,
        tied: tied.map(s => playerById.get(s.player_id)), // the tie-break, winner first
        pool: others,                                   // everyone else still in the running
      }, playerById.get(win.player_id));
    }
  }

  const matchDrawn = matchDigits != null && matchDigits !== '';
  return { champion, second, third, machineChamps, grinder, bigWhiff, theMatch, matchDrawn };
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
  if (v >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B'; // 1.04B vs 1.01B, not both "1B"
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
};
export const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
