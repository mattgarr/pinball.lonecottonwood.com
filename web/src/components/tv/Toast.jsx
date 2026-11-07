import { useEffect } from 'react';
import Avatar from '../Avatar.jsx';
import Icon from '../Icon.jsx';

export const TOAST_MS = 4200;

// Small "board movement" callout: entered the Top Players, or climbed it.
export default function Toast({ item, onDone, paused }) {
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(t);
  }, [item.id, paused, onDone]);
  if (paused) return null;

  const p = item.player;
  return (
    <div className={`toast2 ${item.kind}`} key={item.id}>
      <span className="toast2-icon"><Icon name={item.kind === 'enter' ? 'star' : 'flame'} size={20} stroke={2.2} /></span>
      <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={40} ring />
      <div className="toast2-text">
        <div className="toast2-head">{item.kind === 'enter' ? 'Enters the Top Players' : `Climbs ${item.by} spot${item.by > 1 ? 's' : ''}`}</div>
        <div className="toast2-name">{p.display_name} <span>is now #{item.rank}</span></div>
      </div>
      <div className="toast2-bar" style={{ animationDuration: `${TOAST_MS}ms` }} />
    </div>
  );
}
