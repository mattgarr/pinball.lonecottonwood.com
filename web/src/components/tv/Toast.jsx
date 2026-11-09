import { useEffect } from 'react';
import Avatar from '../Avatar.jsx';
import PixelEmoji from '../PixelEmoji.jsx';

export const TOAST_MS = 4200;

const HEAD = {
  join: () => 'NEW CHALLENGER!',
  enter: () => 'Enters Top Players',
  climb: i => `Climbs ${i.by} spot${i.by > 1 ? 's' : ''}`,
  shame: () => 'New Wall of Shame #1',
  milestone: () => 'Party milestone',
};
const ICON = { join: '🕹️', enter: '⭐', climb: '🔥', shame: '💀', milestone: '🎉' };

// Corner callout: joins, board movement, shame, milestones.
export default function Toast({ item, onDone, paused }) {
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(t);
  }, [item.id, paused, onDone]);
  if (paused) return null;

  const p = item.player;
  const line = item.kind === 'milestone'
    ? <>{item.count} games <span>played tonight</span></>
    : item.kind === 'join' ? <>{p.display_name} <span>has entered the game</span></>
    : item.kind === 'shame' ? <>{p.display_name} <span>ranked with love</span></>
    : <>{p.display_name} <span>is now #{item.rank}</span></>;

  return (
    <div className={`toast2 ${item.kind}`} key={item.id}>
      <span className="toast2-icon"><PixelEmoji e={ICON[item.kind] || '⭐'} size={28} grid={14} /></span>
      {p ? <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={item.kind === 'join' ? 64 : 40} ring /> : null}
      <div className="toast2-text">
        <div className="toast2-head">{(HEAD[item.kind] || HEAD.enter)(item)}</div>
        <div className="toast2-name">{line}</div>
      </div>
      <div className="toast2-bar" style={{ animationDuration: `${TOAST_MS}ms` }} />
    </div>
  );
}
