import { useCallback, useEffect, useRef, useState } from 'react';

export const BOARD_N = 8; // rows shown on the Top Players board
export const HIT_MS = 4500; // how long a cabinet shows "just played"
const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];

// Watches live data and emits:
//  - takeovers (full screen): 'record' = a machine's top score went up; 'leader' = new overall #1
//  - toasts (corner): 'join', 'enter', 'climb', 'milestone', 'shame'
//  - hits (on a cabinet): every new score, for a few seconds
//  - news: recent headlines for the bottom crawl
// The first ready snapshot is only a baseline, so loading the page never celebrates history.
// `demo` fires a sample of every effect in turn (for previewing on the TV: /tv?demo).
export function useLiveEvents({ standings, scores, players, ready, demo = false }) {
  const [takeovers, setTakeovers] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [hits, setHits] = useState({}); // machineId -> hit
  const [news, setNews] = useState([]); // newest first
  const base = useRef(null);

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
    setToasts(q => [...q, ...list.map((n, i) => ({ ...n, id: `${t}-${i}-${n.player?.id ?? n.kind}` }))].slice(-6));
  }, []);

  useEffect(() => {
    if (!ready || demo) return;
    const champs = new Map(standings.machines.map(m => [m.machine.id, m.champion ? { player: m.champion.player, score: m.champion.score } : null]));
    const board = new Map(standings.topPlayers.slice(0, BOARD_N).map(st => [st.player.id, st.rank]));
    const snap = {
      champs, board,
      leader: standings.topPlayers[0]?.player ?? null,
      shame: standings.bottomPlayers?.[0]?.player ?? null,
      playerIds: new Set(players.map(p => p.id)),
      maxScoreId: scores.reduce((m, s) => Math.max(m, s.id), 0),
      games: standings.meta.totalScores,
    };
    const prev = base.current;
    base.current = snap;
    if (!prev) return; // baseline

    const pById = new Map(players.map(p => [p.id, p]));
    const headlines = [];

    // every new score lights its cabinet
    const machineEntry = new Map(standings.machines.map(m => [m.machine.id, m]));
    for (const s of scores) {
      if (s.id <= prev.maxScoreId || s.voided) continue;
      const entry = machineEntry.get(s.machine_id), player = pById.get(s.player_id);
      if (!entry || !player) continue;
      const rank = entry.top.find(t => t.player.id === player.id)?.rank ?? null;
      addHit({ id: `hit-${s.id}`, machine: entry.machine, player, value: s.value, rank });
    }

    // machine records
    const fresh = [];
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

    // new overall leader
    const lead = standings.topPlayers[0];
    if (lead && lead.player.id !== prev.leader?.id) {
      fresh.push({ kind: 'leader', id: `lead:${lead.player.id}:${lead.rating}`, player: lead.player, rating: lead.rating, prevPlayer: prev.leader });
      headlines.push(prev.leader ? `${lead.player.display_name} takes the lead` : `${lead.player.display_name} takes the lead`);
    }
    if (fresh.length) setTakeovers(q => [...q, ...fresh.filter(f => !q.some(x => x.id === f.id))]);

    const notes = [];
    for (const p of players) {
      if (!prev.playerIds.has(p.id)) { notes.push({ kind: 'join', player: p }); headlines.push(`${p.display_name} joins`); }
    }
    for (const st of standings.topPlayers.slice(0, BOARD_N)) {
      if (st.player.id === lead?.player.id && lead.player.id !== prev.leader?.id) continue; // the takeover covers it
      const was = prev.board.get(st.player.id);
      if (was == null) notes.push({ kind: 'enter', player: st.player, rank: st.rank, rating: st.rating });
      else if (st.rank < was) notes.push({ kind: 'climb', player: st.player, rank: st.rank, by: was - st.rank, rating: st.rating });
    }
    const shame = standings.bottomPlayers?.[0]?.player;
    if (shame && prev.shame && shame.id !== prev.shame.id) {
      notes.push({ kind: 'shame', player: shame });
      headlines.push(`${shame.display_name} hits rock bottom`);
    }
    const m = MILESTONES.find(x => prev.games < x && snap.games >= x);
    if (m) { notes.push({ kind: 'milestone', count: m }); headlines.push(`${m} games played`); }
    pushToasts(notes);
    addNews(headlines);
  }, [standings, scores, players, ready, demo, addHit, addNews, pushToasts]);

  // Demo: cycle through every effect using real players and machines.
  useEffect(() => {
    if (!demo || !ready) return;
    const ps = players.length ? players : [];
    const ms = standings.machines;
    if (!ps.length || !ms.length) return;
    let i = Number(new URLSearchParams(location.search).get('demo')) || 0; // ?demo=2 starts at the record takeover
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const fire = () => {
      const p = pick(ps), q = pick(ps.filter(x => x.id !== p.id)) || p, m = pick(ms);
      const value = Math.round((Math.random() * 40 + 1) * 1e5) * 10;
      const k = i++ % 7;
      const t = Date.now();
      addHit({ id: `demo-hit-${t}`, machine: m.machine, player: p, value, rank: 1 + (k % 3) });
      if (k === 0) addNews([`${p.display_name}: ${value.toLocaleString()} on ${m.machine.name}`]);
      if (k === 1) { pushToasts([{ kind: 'join', player: q }]); addNews([`${q.display_name} joins`]); }
      if (k === 2) {
        setTakeovers(x => [...x, { kind: 'record', id: `demo-rec-${t}`, machine: m.machine, player: p, score: value * 3, prevScore: value, prevPlayer: q, N: 5 }]);
        addNews([`${p.display_name} beats ${q.display_name} on ${m.machine.name}`]);
      }
      if (k === 3) pushToasts([{ kind: 'climb', player: p, rank: 2, by: 3 }]);
      if (k === 4) {
        setTakeovers(x => [...x, { kind: 'leader', id: `demo-lead-${t}`, player: p, rating: 87, prevPlayer: q }]);
        addNews([`${p.display_name} takes the lead`]);
      }
      if (k === 5) { pushToasts([{ kind: 'milestone', count: 50 }]); addNews(['50 games played']); }
      if (k === 6) { pushToasts([{ kind: 'shame', player: q }]); addNews([`${q.display_name} hits rock bottom`]); }
    };
    fire();
    const iv = setInterval(fire, 9000);
    return () => clearInterval(iv);
  }, [demo, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextTakeover = useCallback(() => setTakeovers(q => q.slice(1)), []);
  const nextToast = useCallback(() => setToasts(q => q.slice(1)), []);
  return {
    takeover: takeovers[0] ?? null, queued: Math.max(0, takeovers.length - 1), nextTakeover,
    toast: toasts[0] ?? null, nextToast, hits, news,
  };
}
