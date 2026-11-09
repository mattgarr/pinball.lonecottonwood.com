import { useMemo } from 'react';
import Avatar from '../Avatar.jsx';
import Dmd from './Dmd.jsx';
import { fmtShort } from '../../lib/scoring.js';
import { machineGlow, machineShort } from './theme.js';

// "Latest scores" rail: the last N live scores, newest on the left. Each chip mounts with a
// slide-in, so a fresh score visibly pushes the others along.
export default function Ticker({ scores, players, machines, n = 8 }) {
  const items = useMemo(() => {
    const pById = new Map(players.map(p => [p.id, p]));
    const mById = new Map(machines.map(m => [m.id, m]));
    return scores
      .filter(s => !s.voided && pById.has(s.player_id) && mById.has(s.machine_id))
      .sort((a, b) => (b.created_at > a.created_at ? 1 : b.created_at < a.created_at ? -1 : b.id - a.id))
      .slice(0, n)
      .map(s => ({ ...s, player: pById.get(s.player_id), machine: mById.get(s.machine_id) }));
  }, [scores, players, machines, n]);

  return (
    <div className="tk">
      <div className="tk-label"><span className="tk-live" />SCORES</div>
      <ul className="tk-list">
        {items.length ? items.map(s => (
          <li key={s.id} className="tk-chip" style={{ '--glow': machineGlow(s.machine.name) }}>
            <Avatar avatar={s.player.avatar} emoji={s.player.emoji} name={s.player.display_name} color={s.player.color} size={26} />
            <span className="tk-text">
              <span className="tk-name">{s.player.display_name}</span>
              <span className="tk-machine">{machineShort(s.machine.name)}</span>
            </span>
            <Dmd className="tk-score">{fmtShort(s.value)}</Dmd>
          </li>
        )) : <li className="tk-empty">Scores roll in here. Scan to play!</li>}
      </ul>
    </div>
  );
}
