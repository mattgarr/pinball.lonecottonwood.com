import { useCallback, useEffect, useRef, useState } from 'react';

export const BOARD_N = 8; // rows shown on the Top Players board

// Watches live standings and emits:
//  - takeovers: a machine's top score went up (new #1 / new high score) → full-screen celebration
//  - toasts:    someone entered the Top Players board or climbed it
// The first ready snapshot is only a baseline, so loading the page never celebrates history.
export function useLiveEvents(standings, ready) {
  const [takeovers, setTakeovers] = useState([]);
  const [toasts, setToasts] = useState([]);
  const champRef = useRef(null); // Map(machineId -> { player, score } | null)
  const boardRef = useRef(null); // Map(playerId -> rank)

  useEffect(() => {
    if (!ready) return;
    const champs = new Map(standings.machines.map(m => [
      m.machine.id, m.champion ? { player: m.champion.player, score: m.champion.score } : null,
    ]));
    const board = new Map(standings.topPlayers.slice(0, BOARD_N).map(st => [st.player.id, st.rank]));
    const prevChamps = champRef.current, prevBoard = boardRef.current;
    champRef.current = champs;
    boardRef.current = board;
    if (!prevChamps) return; // baseline

    const fresh = [];
    for (const m of standings.machines) {
      const c = m.champion;
      if (!c || !prevChamps.has(m.machine.id)) continue;
      const prev = prevChamps.get(m.machine.id);
      if (!prev || c.score > prev.score) {
        fresh.push({
          id: `${m.machine.id}:${c.player.id}:${c.score}`,
          machine: m.machine, player: c.player, score: c.score, N: m.N,
          prevScore: prev?.score ?? 0,
          prevPlayer: prev && prev.player?.id !== c.player.id ? prev.player : null,
          selfBeat: !!prev && prev.player?.id === c.player.id,
        });
      }
    }
    if (fresh.length) setTakeovers(q => [...q, ...fresh.filter(f => !q.some(x => x.id === f.id))]);

    const notes = [];
    for (const st of standings.topPlayers.slice(0, BOARD_N)) {
      const was = prevBoard.get(st.player.id);
      if (was == null) notes.push({ kind: 'enter', player: st.player, rank: st.rank, rating: st.rating });
      else if (st.rank < was) notes.push({ kind: 'climb', player: st.player, rank: st.rank, by: was - st.rank, rating: st.rating });
    }
    if (notes.length) {
      const t = Date.now();
      setToasts(q => [...q, ...notes.map((n, i) => ({ ...n, id: `${t}-${i}-${n.player.id}` }))].slice(-6));
    }
  }, [standings, ready]);

  const nextTakeover = useCallback(() => setTakeovers(q => q.slice(1)), []);
  const nextToast = useCallback(() => setToasts(q => q.slice(1)), []);
  return { takeover: takeovers[0] ?? null, queued: Math.max(0, takeovers.length - 1), nextTakeover, toast: toasts[0] ?? null, nextToast };
}
