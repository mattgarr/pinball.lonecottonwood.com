import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtShort } from '../../lib/scoring.js';
import { machineHighlights } from '../../lib/content.js';

export const BOARD_N = 8; // rows shown on the Top Players board
export const HIT_MS = 4500; // how long a cabinet shows "just played"
const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
const TAKEOVER_MILESTONES = new Set([25, 50, 75, 100, 150, 200, 250, 300, 400, 500]);
const ATTRACT_CHECK_MS = 75000; // check every 75s if room has been quiet
const ATTRACT_QUIET_MS = 45000; // require 45s of quiet before showing an attract spotlight

// Build deterministic "Arcade Attract" spotlight cards from live party data.
export function buildSpotlights({ standings, scores, players, freePlay = false }, machineCursor = 0) {
  const cards = [];
  const ms = standings?.machines ?? [];
  if (!ms.length) return cards;
  // Free play: no battles or bounties (nothing's at stake), just the machine tips.
  if (freePlay) return buildTips(ms, players, machineCursor);

  // 1. CLOSEST BATTLE (tightest #1 vs #2 margin on any machine)
  let closest = null;
  for (const m of ms) {
    if (m.top.length >= 2 && m.top[0].score > 0) {
      const s1 = m.top[0], s2 = m.top[1];
      const gap = s1.score - s2.score;
      const ratio = gap / s1.score;
      if (!closest || ratio < closest.ratio) {
        closest = { machine: m.machine, leader: s1, challenger: s2, gap, ratio, N: m.N };
      }
    }
  }
  if (closest) {
    cards.push({
      kind: 'spotlight',
      subkind: 'rivalry',
      id: `spot-riv-${closest.machine.id}-${closest.gap}`,
      ...closest,
    });
  }

  // 2. CROWN BOUNTY (longest-standing #1 record tonight) or OPEN TABLE (fewest plays)
  const openEntry = [...ms].sort((a, b) => a.N - b.N)[0];
  if (openEntry && openEntry.N < 3) {
    const needCount = Math.max(1, players.length - openEntry.N);
    cards.push({
      kind: 'spotlight',
      subkind: 'bounty',
      bountyType: 'open',
      id: `spot-open-${openEntry.machine.id}-${openEntry.N}`,
      machine: openEntry.machine,
      champion: openEntry.champion,
      N: openEntry.N,
      needCount,
    });
  } else {
    // Find the #1 score whose timestamp has survived the longest
    let oldest = null;
    for (const m of ms) {
      if (!m.champion) continue;
      const winningRow = scores.find(
        s => !s.voided && s.machine_id === m.machine.id && s.player_id === m.champion.player.id && s.value === m.champion.score,
      );
      const ts = winningRow?.created_at ? new Date(winningRow.created_at).getTime() : Date.now() - 1800000;
      const mins = Math.max(5, Math.round((Date.now() - ts) / 60000));
      if (!oldest || mins > oldest.mins) {
        oldest = { machine: m.machine, champion: m.champion, mins, N: m.N };
      }
    }
    if (oldest) {
      cards.push({
        kind: 'spotlight',
        subkind: 'bounty',
        bountyType: 'crown',
        id: `spot-bounty-${oldest.machine.id}-${oldest.champion.score}`,
        ...oldest,
      });
    }
  }

  cards.push(...buildTips(ms, players, machineCursor));
  return cards;
}

// MACHINE SPOTLIGHT + PRO TIP & FUN FACT (from /content/machine-*.md)
function buildTips(ms, players, machineCursor) {
  const cards = [];
  const withTips = ms
    .map(m => ({ entry: m, hi: machineHighlights(m.machine.name) }))
    .filter(x => x.hi.tips.length > 0);
  if (withTips.length > 0) {
    const pick = withTips[machineCursor % withTips.length];
    const m = pick.entry;
    const tip = pick.hi.tips[machineCursor % pick.hi.tips.length];
    const fact = pick.hi.facts[machineCursor % Math.max(1, pick.hi.facts.length)] || null;
    const needCount = Math.max(0, players.length - m.N);
    cards.push({
      kind: 'spotlight',
      subkind: 'tip',
      id: `spot-tip-${m.machine.id}-${machineCursor}`,
      machine: m.machine,
      champion: m.champion,
      N: m.N,
      needCount,
      tip,
      fact,
    });
  }

  return cards;
}

// Watches live data and emits:
//  - takeovers (full screen):
//      'record'    = a machine's top score went up
//      'leader'    = new overall #1
//      'ranked'    = player finished their 2nd machine & unlocked overall ranking
//      'milestone' = major party game count milestone (25, 50, 75, 100...)
//      'spotlight' = periodic arcade attract spotlight during quiet moments
//  - toasts (corner): 'join', 'enter', 'climb', 'pb', 'close', 'milestone', 'shame'
//  - hits (on a cabinet): every new score, for a few seconds (with PB / close badges)
//  - news: recent headlines for the bottom crawl
// freePlay: the free-play board. Standings then cover every game tonight; only hits, new high
// scores, PBs, close calls and joins fire (nothing about tournament ranks).
// sealed: the podium is a secret (last 15 min until the reveal): no leader / ranked / climb / shame moments.
// lastCall: the last 15 minutes: the closest-battle spotlight shows without waiting for a quiet room.
export function useLiveEvents({ standings, scores, players, ready, demo = false, freePlay = false, sealed = false, lastCall = false }) {
  const [takeovers, setTakeovers] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [hits, setHits] = useState({}); // machineId -> hit
  const [news, setNews] = useState([]); // newest first
  const base = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const spotCursorRef = useRef(0);
  const dataRef = useRef({ standings, scores, players, freePlay, lastCall });
  dataRef.current = { standings, scores, players, freePlay, lastCall };
  const quiet = freePlay || sealed; // no tournament-rank moments

  const addNews = useCallback(items => {
    if (!items.length) return;
    const t = Date.now();
    setNews(n => [...items.map((text, i) => ({ id: `${t}-${i}`, text })), ...n].slice(0, 8));
  }, []);

  const addHit = useCallback(hit => {
    setHits(h => ({ ...h, [hit.machine.id]: hit }));
    setTimeout(() => setHits(h => (h[hit.machine.id]?.id === hit.id ? (({ [hit.machine.id]: _, ...rest }) => rest)(h) : h)), HIT_MS);
  }, []);

  const pushToasts = useCallback(list => {
    if (!list.length) return;
    const t = Date.now();
    setToasts(q => {
      const all = [...q, ...list.map((n, i) => ({ ...n, id: `${t}-${i}-${n.player?.id ?? n.kind}` }))];
      return all.length > 6 ? [all[0], ...all.slice(-5)] : all; // never cut off the one on screen
    });
  }, []);

  useEffect(() => {
    if (!ready || demo) return;
    const champs = new Map(standings.machines.map(m => [m.machine.id, m.champion ? { player: m.champion.player, score: m.champion.score } : null]));
    const board = new Map(standings.topPlayers.slice(0, BOARD_N).map(st => [st.player.id, st.rank]));
    const rankedIds = new Set(standings.ranked.map(st => st.player.id));
    const playerMachineBest = new Map();
    for (const s of scores) {
      if (s.voided) continue;
      const k = `${s.player_id}:${s.machine_id}`;
      const cur = playerMachineBest.get(k) ?? 0;
      if (s.value > cur) playerMachineBest.set(k, s.value);
    }

    const snap = {
      freePlay, champs, board, rankedIds, playerMachineBest,
      leader: standings.topPlayers[0]?.player ?? null,
      shame: standings.bottomPlayers?.[0]?.player ?? null,
      playerIds: new Set(players.map(p => p.id)),
      maxScoreId: scores.reduce((m, s) => Math.max(m, s.id), 0),
      seen: new Set(scores.map(s => s.id)),
      games: standings.meta.totalScores,
    };
    const prev = base.current;
    base.current = snap;
    if (!prev || prev.freePlay !== freePlay) return; // baseline (also when switching boards)
    // A big jump all at once (the Mac woke from sleep, or the host switched events) is a catch-up,
    // not a burst of live moments: take it as the new baseline without a parade of takeovers.
    const newCount = scores.reduce((n, s) => n + (prev.seen.has(s.id) || s.voided ? 0 : 1), 0);
    const newlyRanked = standings.ranked.reduce((n, st) => n + (prev.rankedIds.has(st.player.id) ? 0 : 1), 0);
    if (newCount > 6 || newlyRanked > 4) return;

    const pById = new Map(players.map(p => [p.id, p]));
    const headlines = [];
    const notes = [];
    const fresh = [];

    // Every new score lights its cabinet + checks for PB or close call
    const machineEntry = new Map(standings.machines.map(m => [m.machine.id, m]));
    let lastNewScore = null;
    for (const s of scores) {
      if (prev.seen.has(s.id) || s.voided) continue; // (ids can arrive out of order)
      lastActivityRef.current = Date.now();
      const entry = machineEntry.get(s.machine_id), player = pById.get(s.player_id);
      if (!entry || !player) continue;
      lastNewScore = { score: s, entry, player };
      // Where THIS game lands on the machine (not the player's best), among everyone who played it.
      const champScore = entry.champion?.score ?? 0;
      const rank = s.value >= champScore && champScore > 0
        ? 1
        : 1 + (entry.rows || []).filter(r => r.best > s.value && r.playerId !== player.id).length;
      const prevBest = prev.playerMachineBest.get(`${s.player_id}:${s.machine_id}`) ?? null;
      const isPB = prevBest != null && s.value > prevBest && rank !== 1;
      const isClose = rank === 2 && champScore > 0 && s.value >= champScore * 0.85 && s.value < champScore;

      addHit({ id: `hit-${s.id}`, machine: entry.machine, player, value: s.value, rank, isPB, isClose });

      if (isClose) {
        const gap = champScore - s.value;
        notes.push({ kind: 'close', player, machine: entry.machine, gap });
        headlines.push(`SO CLOSE! ${player.display_name} missed #1 on ${entry.machine.name} by ${fmtShort(gap)}`);
      } else if (isPB) {
        notes.push({ kind: 'pb', player, machine: entry.machine, value: s.value, rank });
        headlines.push(`${player.display_name} set a new PB on ${entry.machine.name} (${fmtShort(s.value)})`);
      }
    }

    // Machine #1 records
    for (const m of standings.machines) {
      const c = m.champion;
      if (!c || !prev.champs.has(m.machine.id)) continue;
      const was = prev.champs.get(m.machine.id);
      if (!was || c.score > was.score) {
        const item = {
          kind: 'record', id: `${m.machine.id}:${c.player.id}:${c.score}`,
          machine: m.machine, player: c.player, score: c.score, N: m.N,
          prevScore: was?.score ?? 0,
          prevPlayer: was && was.player?.id !== c.player.id ? was.player : null,
          selfBeat: !!was && was.player?.id === c.player.id,
        };
        fresh.push(item);
        headlines.push(item.prevPlayer
          ? `${c.player.display_name} beats ${item.prevPlayer.display_name} on ${m.machine.name}`
          : `${c.player.display_name}: new ${m.machine.name} record`);
      }
    }

    // New overall #1 leader (tournament only)
    const lead = quiet ? null : standings.topPlayers[0];
    if (lead && lead.player.id !== prev.leader?.id) {
      fresh.push({ kind: 'leader', id: `lead:${lead.player.id}:${lead.rating}`, player: lead.player, rating: lead.rating, prevPlayer: prev.leader });
      headlines.push(`${lead.player.display_name} takes the overall lead`);
    }

    // Newly ranked player (completed 2nd machine and unlocked overall ranking!)
    for (const st of quiet ? [] : standings.ranked) {
      if (!prev.rankedIds.has(st.player.id)) {
        const isNewLeader = lead && st.player.id === lead.player.id && lead.player.id !== prev.leader?.id;
        if (!isNewLeader) {
          fresh.push({
            kind: 'ranked',
            id: `ranked:${st.player.id}:${st.rating}`,
            player: st.player,
            rank: st.rank,
            rating: st.rating,
            totalRanked: standings.ranked.length,
          });
        }
        headlines.push(`${st.player.display_name} unlocked their ranking at #${st.rank} (${st.rating} pts)`);
      }
    }

    // Milestones: major ones get a full-screen takeover, minor ones get a corner toast
    const m = freePlay ? null : MILESTONES.find(x => prev.games < x && snap.games >= x);
    if (m) {
      if (TAKEOVER_MILESTONES.has(m)) {
        fresh.push({
          kind: 'milestone',
          id: `mile:${m}`,
          count: m,
          player: lastNewScore?.player ?? null,
          machine: lastNewScore?.entry?.machine ?? null,
          totalPlayers: standings.meta.totalPlayers,
        });
      } else {
        notes.push({ kind: 'milestone', count: m });
      }
      headlines.push(`${m} games played tonight!`);
    }

    // If any real live event happened, preempt any active attract spotlight immediately!
    if (fresh.length) {
      lastActivityRef.current = Date.now();
      setTakeovers(q => {
        const all = [...q.filter(x => x.kind !== 'spotlight'), ...fresh.filter(f => !q.some(x => x.id === f.id))];
        // Keep the queue short: past 4 waiting, drop "newly ranked" cards first (records and #1 stay).
        while (all.length > 4) {
          const i = all.findIndex((x, k) => k > 0 && x.kind === 'ranked');
          if (i < 0) break;
          all.splice(i, 1);
        }
        return all;
      });
    } else if (lastNewScore) {
      // Even a non-record score clears an attract spotlight so the player sees their score hit on the board
      setTakeovers(q => q.filter(x => x.kind !== 'spotlight'));
    }

    for (const p of players) {
      if (!prev.playerIds.has(p.id)) { notes.push({ kind: 'join', player: p }); headlines.push(`${p.display_name} joins`); }
    }
    for (const st of quiet ? [] : standings.topPlayers.slice(0, BOARD_N)) {
      if (st.player.id === lead?.player.id && lead.player.id !== prev.leader?.id) continue;
      if (!prev.rankedIds.has(st.player.id)) continue; // covered by 'ranked' takeover
      const was = prev.board.get(st.player.id);
      if (was == null) notes.push({ kind: 'enter', player: st.player, rank: st.rank, rating: st.rating });
      else if (st.rank < was) notes.push({ kind: 'climb', player: st.player, rank: st.rank, by: was - st.rank, rating: st.rating });
    }
    const shame = quiet ? null : standings.bottomPlayers?.[0]?.player;
    if (shame && prev.shame && shame.id !== prev.shame.id) {
      notes.push({ kind: 'shame', player: shame });
      headlines.push(`${shame.display_name} hits rock bottom`);
    }
    pushToasts(notes);
    addNews(headlines);
  }, [standings, scores, players, ready, demo, freePlay, quiet, addHit, addNews, pushToasts]);

  // URL preview support (?spotlight=0, 1, 2 or ?takeover=ranked / milestone / record / leader) + Periodic Quiet-Room Attract Spotlights
  useEffect(() => {
    if (!ready || demo) return;
    const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    const p1 = players[0] || { id: 1, display_name: 'WizardWalt', emoji: '🧙', color: '#3cbcfc' };
    const p2 = players[1] || { id: 2, display_name: 'Flipper Fran', emoji: '🦖', color: '#f8b800' };
    const m0 = standings.machines[0]?.machine || { id: 1, name: 'Centaur', manufacturer: 'Bally', year: 1981 };

    if (params?.has('spotlight')) {
      const raw = params.get('spotlight');
      const cards = buildSpotlights({ standings, scores, players }, Number(raw) || 0);
      const bySub = sub => cards.find(c => c.subkind === sub);
      let chosen = null;
      if (raw === '0' || raw === 'rivalry') {
        chosen = bySub('rivalry') || {
          kind: 'spotlight', subkind: 'rivalry', id: 'preview-riv',
          machine: m0,
          leader: { player: p1, score: 4200000 },
          challenger: { player: p2, score: 4080000 },
          gap: 120000, ratio: 0.028, N: 4,
        };
      } else if (raw === '1' || raw === 'bounty') {
        chosen = bySub('bounty') || {
          kind: 'spotlight', subkind: 'bounty', bountyType: 'open', id: 'preview-bounty',
          machine: m0, champion: null, N: 0, needCount: Math.max(4, players.length),
        };
      } else {
        chosen = bySub('tip') || cards[0];
      }
      if (chosen) setTakeovers([{ ...chosen, pinned: true }]);
      return;
    }
    if (params?.get('takeover') === 'ranked') {
      const st = standings.ranked[1] || standings.ranked[0] || { player: p1, rank: 2, rating: 78 };
      setTakeovers([{ kind: 'ranked', id: 'preview-ranked', player: st.player, rank: st.rank, rating: st.rating, totalRanked: standings.ranked.length || 5, pinned: true }]);
      return;
    }
    if (params?.get('takeover') === 'milestone') {
      setTakeovers([{ kind: 'milestone', id: 'preview-mile', count: 50, player: p1, machine: m0, totalPlayers: players.length || 6, pinned: true }]);
      return;
    }
    if (params?.get('takeover') === 'record') {
      setTakeovers([{ kind: 'record', id: 'preview-rec', machine: m0, player: p1, score: 4200000, prevScore: 3100000, prevPlayer: p2, N: 5, pinned: true }]);
      return;
    }
    if (params?.get('takeover') === 'leader') {
      setTakeovers([{ kind: 'leader', id: 'preview-lead', player: p1, rating: 92, prevPlayer: p2, pinned: true }]);
      return;
    }

    // (Reads the latest data through a ref: the 60 s data refresh must not keep restarting this timer.)
    const iv = setInterval(() => {
      const last = dataRef.current.lastCall;
      if (!last && Date.now() - lastActivityRef.current < ATTRACT_QUIET_MS) return;
      setTakeovers(q => {
        if (q.length > 0) return q;
        const cur = spotCursorRef.current++;
        const cards = buildSpotlights(dataRef.current, cur);
        if (!cards.length) return q;
        // Last call: the closest battle on any machine, every time.
        const riv = last && cards.find(c => c.subkind === 'rivalry');
        return [riv || cards[cur % cards.length]];
      });
    }, ATTRACT_CHECK_MS);
    return () => clearInterval(iv);
  }, [ready, demo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Demo: cycle through every effect using real players and machines.
  useEffect(() => {
    if (!demo || !ready) return;
    const ps = players.length ? players : [];
    const ms = standings.machines;
    if (!ps.length || !ms.length) return;
    let i = Number(new URLSearchParams(location.search).get('demo')) || 0;
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const fire = () => {
      const p = pick(ps), q = pick(ps.filter(x => x.id !== p.id)) || p, m = pick(ms);
      const value = Math.round((Math.random() * 40 + 1) * 1e5) * 10;
      const k = i++ % 9;
      const t = Date.now();
      // Only events that come from a score flash a cabinet (joins, rankings, spotlights and the Wall
      // of Shame don't), so the cabinet that lights up is always the one the screen is talking about.
      if ([0, 2, 3, 4, 7].includes(k)) addHit({ id: `demo-hit-${t}`, machine: m.machine, player: p, value, rank: 1 + (k % 3), isPB: k === 3 });
      if (k === 0) addNews([`${p.display_name}: ${value.toLocaleString()} on ${m.machine.name}`]);
      if (k === 1) { pushToasts([{ kind: 'join', player: q }]); addNews([`${q.display_name} joins`]); }
      if (k === 2) {
        setTakeovers(x => [...x, { kind: 'record', id: `demo-rec-${t}`, machine: m.machine, player: p, score: value * 3, prevScore: value, prevPlayer: q, N: 5 }]);
        addNews([`${p.display_name} beats ${q.display_name} on ${m.machine.name}`]);
      }
      if (k === 3) pushToasts([{ kind: 'pb', player: p, machine: m.machine, value, rank: 2 }]);
      if (k === 4) {
        setTakeovers(x => [...x, { kind: 'leader', id: `demo-lead-${t}`, player: p, rating: 87, prevPlayer: q }]);
        addNews([`${p.display_name} takes the lead`]);
      }
      if (k === 5) {
        setTakeovers(x => [...x, { kind: 'ranked', id: `demo-rank-${t}`, player: q, rank: 3, rating: 76, totalRanked: ps.length }]);
      }
      if (k === 6) {
        const cards = buildSpotlights({ standings, scores, players }, i);
        if (cards.length) setTakeovers(x => [...x, cards[0]]);
      }
      if (k === 7) {
        setTakeovers(x => [...x, { kind: 'milestone', id: `demo-mile-${t}`, count: 50, player: p, machine: m.machine, totalPlayers: ps.length }]);
      }
      if (k === 8) { pushToasts([{ kind: 'shame', player: q }]); addNews([`${q.display_name} hits rock bottom`]); }
    };
    fire();
    const iv = setInterval(fire, 9000);
    return () => clearInterval(iv);
  }, [demo, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // The lights simulator's event buttons: show that moment on this TV (the lights then follow the TV).
  const inject = useCallback((kind, machineId) => {
    const ps = players, ms = standings.machines;
    if (!ps.length || !ms.length) return;
    const p = ps[Math.floor(Math.random() * ps.length)], q = ps.find(x => x.id !== p.id) || p;
    const m = ms.find(x => x.machine.id === Number(machineId)) || ms[0];
    const value = Math.round((Math.random() * 40 + 1) * 1e5) * 10;
    const t = Date.now();
    lastActivityRef.current = t;
    if (['score', 'champion', 'leader', 'milestone'].includes(kind)) {
      addHit({ id: `sim-hit-${t}`, machine: m.machine, player: p, value, rank: kind === 'champion' ? 1 : 2, isPB: false });
    }
    const add = item => setTakeovers([item]); // a button press shows right away (replaces what's up)
    if (kind === 'champion') add({ kind: 'record', id: `sim-rec-${t}`, machine: m.machine, player: p, score: value * 3, prevScore: value, prevPlayer: q, N: 5 });
    if (kind === 'leader') add({ kind: 'leader', id: `sim-lead-${t}`, player: p, rating: 87, prevPlayer: q });
    if (kind === 'ranked') add({ kind: 'ranked', id: `sim-rank-${t}`, player: p, rank: 3, rating: 76, totalRanked: ps.length });
    if (kind === 'milestone') add({ kind: 'milestone', id: `sim-mile-${t}`, count: 50, player: p, machine: m.machine, totalPlayers: ps.length });
    if (kind === 'shame') pushToasts([{ kind: 'shame', player: q }]);
  }, [players, standings, addHit, pushToasts]);

  // Clock moments (countdown marks, start, end) go straight to the front, replacing a spotlight.
  const pushTakeover = useCallback(item => {
    lastActivityRef.current = Date.now();
    setTakeovers(q => [item, ...q.filter(x => x.kind !== 'spotlight' && x.id !== item.id)]);
  }, []);
  const nextTakeover = useCallback(() => setTakeovers(q => q.slice(1)), []);
  const nextToast = useCallback(() => setToasts(q => q.slice(1)), []);
  return {
    takeover: takeovers[0] ?? null, queued: Math.max(0, takeovers.length - 1), nextTakeover,
    toast: toasts[0] ?? null, nextToast, hits, news, inject, pushTakeover,
  };
}
