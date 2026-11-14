// Standings and prizes, computed in the browser from the raw scores.
//
// Raw scores aren't comparable across machines (a great Fathom game is ~3M; Cactus Canyon
// runs 100M+), so nothing here adds raw scores together. Instead:
//   STANDING on a machine = where your best score places among everyone who played it:
//     round(100 * (N - rank + 1) / N)   → 1st = 100, last ≈ 100/N, ties share a rank.
//   RATING = the plain average of your standings across the machines you played.
//     You need MIN_TABLES machines to get a rating (and appear on the boards).
//   The podium (Grand Champion, 2nd, 3rd) needs PODIUM_MIN machines (Matt, Nov 10): someone on 2
//   machines is rated and on the boards, but the podium skips them (the reveal stamps "NEEDS 3 MACHINES").
//   Ranking sorts on the exact (unrounded) average; the board shows it rounded.

export const MIN_TABLES = 2;
export const PODIUM_MIN = 3;
export const podiumOk = st => !!st && st.rating != null && st.machinesPlayed >= PODIUM_MIN;

// Free-play scores (before the start, after the end, after the awards) never count for the
// tournament. includeFreePlay: every game tonight (the free-play board and its live moments).
const liveScores = (scores, includeFreePlay = false) => scores.filter(s => !s.voided && (includeFreePlay || !s.free_play));

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

// Best first: exact average, then machine crowns, then machines played, then who joined first.
const EPS = 1e-9;
export function byRank(a, b) {
  const d = (b.exact ?? b.rating) - (a.exact ?? a.rating);
  return (Math.abs(d) > EPS ? d : 0) || b.crowns - a.crowns || b.machinesPlayed - a.machinesPlayed || a.player.id - b.player.id;
}

// Why `a` is ahead of `b` when both show the same rounded rating (null when the ratings differ):
// "Tied at 87 · 87.4 vs 87.1 before rounding" / "· more machine crowns" / "· more machines played" / "· joined first".
export function tieBreakNote(a, b) {
  if (!a || !b || a.rating == null || a.rating !== b.rating) return null;
  const head = `Tied at ${a.rating}`;
  const ea = a.exact ?? a.rating, eb = b.exact ?? b.rating;
  if (Math.abs(ea - eb) > EPS) {
    for (const d of [1, 2, 3]) {
      const x = ea.toFixed(d), y = eb.toFixed(d);
      if (x !== y) return `${head} · ${x} vs ${y} before rounding`;
    }
    return `${head} · a hair ahead before rounding`;
  }
  if (a.crowns !== b.crowns) return `${head} · more machine crowns`;
  if (a.machinesPlayed !== b.machinesPlayed) return `${head} · more machines played`;
  return `${head} · joined first`;
}

// Every game on a machine, best first (ties: the earlier game first), with shared ranks for equal scores.
function rankGames(list, playerById, n) {
  const sorted = [...list].sort((a, b) => b.value - a.value || a.id - b.id);
  let rank = 0, prev = null;
  return sorted.slice(0, n).map((s, i) => {
    if (s.value !== prev) { rank = i + 1; prev = s.value; }
    return { rank, player: playerById.get(s.player_id), score: s.value, freePlay: !!s.free_play, scoreId: s.id };
  });
}

export function computeStandings({ machines = [], players = [], scores = [], includeFreePlay = false }) {
  const live = liveScores(scores, includeFreePlay);
  const playerById = new Map(players.map(p => [p.id, p]));

  const stats = new Map(players.map(p => [p.id, {
    player: p, plays: 0, machinesPlayed: 0, standingSum: 0, exactSum: 0,
    perMachine: {}, crowns: 0, worst: null, best: null, rating: null, avg: null, exact: null, rank: null,
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
      st.exactSum += (100 * (r.N - r.rank + 1)) / r.N; // the standing before rounding
      if (r.rank === 1) st.crowns++;
      if (!st.worst || r.standing < st.worst.standing) st.worst = { machineId: m.id, machineName: m.name, rank: r.rank, N: r.N, standing: r.standing };
      if (!st.best || r.standing > st.best.standing) st.best = { machineId: m.id, machineName: m.name, rank: r.rank, N: r.N, standing: r.standing };
    }
    const top = rows.slice(0, 10).map(r => ({ player: playerById.get(r.playerId), score: r.best, rank: r.rank }));
    // games: the machine's high-score table as shown (every game, so a player can appear more than
    // once; Matt, Nov 14). Standings, prizes and `top` still use each player's best.
    const games = rankGames(live.filter(s => s.machine_id === m.id && playerById.has(s.player_id)), playerById, 10);
    return { machine: m, N: rows.length, top, games, rows, champion: top[0] ?? null };
  });

  for (const st of stats.values()) {
    if (st.machinesPlayed) {
      st.exact = st.exactSum / st.machinesPlayed;
      st.avg = Math.round(st.exact);
    }
    if (st.machinesPlayed >= MIN_TABLES) st.rating = st.avg;
  }

  const eligible = [...stats.values()]
    .filter(st => st.rating != null)
    .sort(byRank);
  // Ranks follow exactly this order (exact rating, then crowns, then machines played, then who joined
  // first), so the board, the Ranks page, the emails and the prizes agree: no shared ranks.
  eligible.forEach((st, i) => { st.rank = i + 1; });

  const topPlayers = eligible.slice(0, 10);
  // Wall of Shame: lowest ratings. It skips only the podium (not the whole Top Players board)
  // so it fills up early in the night too.
  const podium = new Set(eligible.filter(podiumOk).slice(0, 3).map(st => st.player.id));
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
  const live = liveScores(scores);
  const playerById = new Map(players.map(p => [p.id, p]));
  const machineById = new Map(machines.map(m => [m.id, m]));
  const all = [...standings.stats.values()];

  const taken = new Set();
  const free = p => !!p && !(ONE_PRIZE_EACH && taken.has(p.id));
  const claim = (x, p) => { if (x && p) taken.add(p.id); return x ?? null; };

  // Grand Champion, 2nd and 3rd: the best overall ratings among players with PODIUM_MIN+ machines.
  const nextRanked = () => { const st = standings.ranked.find(x => podiumOk(x) && free(x.player)); return claim(st, st?.player); };
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
  // compares it with the last two digits of each player's TOTAL points tonight (all their games added
  // up: one number per person, so more games doesn't mean more chances). Everyone whose total matches is
  // in the tie-break; if nobody matches, everyone still without a prize is. The tie-break picks one player at
  // random (a fixed shuffle of the draw, so every screen agrees) and the TV shows it as a slot-machine spin.
  let theMatch = null;
  if (matchDigits != null && matchDigits !== '') {
    const draw = Math.floor((((Number(matchDigits) % 100) + 100) % 100) / 10) * 10;
    const dist = v => { const d = Math.abs((v % 100) - draw); return Math.min(d, 100 - d); };
    const shuffle = id => {
      let h = Math.imul(id ^ Math.imul(draw + 1, 0x9e3779b1), 0x85ebca6b);
      h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
      return h >>> 0;
    };
    const totals = new Map(); // playerId -> { total, games }
    for (const s of live) {
      if (!free(playerById.get(s.player_id))) continue;
      const t = totals.get(s.player_id) || { total: 0, games: 0 };
      t.total += Number(s.value) || 0; t.games++;
      totals.set(s.player_id, t);
    }
    const entries = [...totals].map(([id, t]) => ({ player: playerById.get(id), ...t }));
    if (entries.length) {
      // Nobody matches: everyone still in the running goes into the spin, so the prize is always won.
      const exact = entries.some(e => dist(e.total) === 0);
      const min = exact ? 0 : Math.min(...entries.map(e => dist(e.total)));
      const tied = entries.filter(e => !exact || dist(e.total) === 0).sort((a, b) => shuffle(a.player.id) - shuffle(b.player.id));
      const win = tied[0];
      const pool = entries.filter(e => !tied.includes(e)).map(e => e.player).sort((a, b) => shuffle(a.id) - shuffle(b.id));
      theMatch = claim({
        player: win.player, value: win.total, games: win.games, drawn: draw, distance: min, exact: min === 0,
        tied: tied.map(e => e.player), // the tie-break, winner first
        pool,                          // everyone else still in the running
      }, win.player);
    }
  }

  const matchDrawn = matchDigits != null && matchDigits !== '';
  return { champion, second, third, machineChamps, grinder, bigWhiff, theMatch, matchDrawn };
}

// Free-play board: each machine's high score table across every game tonight (tournament and free
// play), one row per player (their best), best first. freePlay marks a best set in free play.
export function computeHighScores({ machines = [], players = [], scores = [], n = 10 }) {
  const playerById = new Map(players.map(p => [p.id, p]));
  const ok = scores.filter(s => !s.voided && playerById.has(s.player_id));
  return machines.map(machine => {
    const list = ok.filter(s => s.machine_id === machine.id);
    return { machine, N: new Set(list.map(s => s.player_id)).size, top: rankGames(list, playerById, n) };
  });
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

// Every prize in reveal order with its winner (null: nobody won it), for the phones after the awards.
export function winnersList(awards = {}) {
  const row = (prize, x, stat = '') => ({ prize, player: x?.player ?? null, stat: x?.player ? stat : '' });
  return [
    row('Grand Champion', awards.champion, awards.champion ? `${awards.champion.rating}/100` : ''),
    row('2nd Place', awards.second, awards.second ? `${awards.second.rating}/100` : ''),
    row('3rd Place', awards.third, awards.third ? `${awards.third.rating}/100` : ''),
    ...(awards.machineChamps ?? []).map(c => row(`${c.machine.name} Champion`, c, c.player ? fmtShort(c.score) : '')),
    row('The Grinder', awards.grinder, awards.grinder ? `${awards.grinder.plays} games` : ''),
    row('The Big Whiff', awards.bigWhiff, awards.bigWhiff ? `${awards.bigWhiff.rating}/100` : ''),
    row('The Match', awards.theMatch, awards.theMatch ? `Match ${String(awards.theMatch.drawn).padStart(2, '0')}` : ''),
  ];
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
