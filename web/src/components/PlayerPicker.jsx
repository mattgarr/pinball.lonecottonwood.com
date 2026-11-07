import { useMemo, useState } from 'react';
import Avatar from './Avatar.jsx';

// Roster picker: recent players first (who's been logging scores lately — likely the people
// standing next to you), then everyone A–Z. Search filters both.
//   exclude: Set of player ids not to show
//   allowMe / allowSkip: extra rows for the "Who was who?" screen
export default function PlayerPicker({ players, scores, me, machineId, exclude, allowMe, allowSkip, onPick }) {
  const [q, setQ] = useState('');

  const { recent, everyone } = useMemo(() => {
    const last = new Map(); // pid -> [onThisMachine, latest ms]
    for (const s of scores) {
      const t = Date.parse(s.created_at) || 0;
      const prev = last.get(s.player_id) || [0, 0];
      last.set(s.player_id, [prev[0] || (s.machine_id === machineId && t > Date.now() - 45 * 60e3) ? 1 : 0, Math.max(prev[1], t)]);
    }
    const pool = players.filter(p => p.id !== me?.id && !exclude?.has(p.id));
    const recent = pool
      .filter(p => last.has(p.id))
      .sort((a, b) => (last.get(b.id)[0] - last.get(a.id)[0]) || (last.get(b.id)[1] - last.get(a.id)[1]))
      .slice(0, 8);
    // newcomers who just joined but haven't scored yet are "recent" too
    const fresh = pool.filter(p => !last.has(p.id) && Date.parse(p.created_at) > Date.now() - 30 * 60e3).slice(-4);
    const everyone = [...pool].sort((a, b) => a.display_name.localeCompare(b.display_name));
    return { recent: [...recent, ...fresh], everyone };
  }, [players, scores, me, machineId, exclude]);

  const needle = q.trim().toLowerCase();
  const matches = needle ? everyone.filter(p => p.display_name.toLowerCase().includes(needle)) : null;

  const Row = ({ p }) => (
    <button type="button" className="pick-row" onClick={() => onPick(p.id)}>
      <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={36} />
      <span className="pick-name">{p.display_name}</span>
    </button>
  );

  return (
    <div className="picker">
      <input
        className="picker-search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="🔍  Search names"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {allowMe && !needle && (
        <button type="button" className="pick-row pick-me" onClick={() => onPick('me')}>
          <Avatar avatar={me.avatar} emoji={me.emoji} name={me.display_name} color={me.color} size={36} />
          <span className="pick-name">That's me</span>
        </button>
      )}
      {matches ? (
        <>
          {matches.length === 0 && <div className="muted small picker-empty">No “{q}” yet. They must join first.</div>}
          {matches.map(p => <Row key={p.id} p={p} />)}
        </>
      ) : (
        <>
          {recent.length > 0 && <div className="picker-label">Recent</div>}
          {recent.map(p => <Row key={`r${p.id}`} p={p} />)}
          <div className="picker-label">Everyone</div>
          {everyone.length === 0 && <div className="muted small picker-empty">No one else yet.</div>}
          {everyone.map(p => <Row key={p.id} p={p} />)}
        </>
      )}
      {allowSkip && (
        <button type="button" className="pick-row pick-skip" onClick={() => onPick(null)}>
          <span className="pick-skip-icon">⤼</span>
          <span className="pick-name">Skip this one</span>
        </button>
      )}
    </div>
  );
}
