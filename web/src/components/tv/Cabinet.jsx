import Avatar from '../Avatar.jsx';
import Icon from '../Icon.jsx';
import Backbox from './Backbox.jsx';
import Dmd from './Dmd.jsx';
import { fmtShort } from '../../lib/scoring.js';
import { machineGlow } from './theme.js';

// One machine column: lit backbox on top, name plate, then the top-10 like a high-score table.
export default function Cabinet({ entry, i, hot }) {
  const { machine: m, top, N } = entry;
  return (
    <div className={`cab2${hot ? ' hot' : ''}`} style={{ '--glow': machineGlow(m.name), '--i': i }}>
      <Backbox machine={m} i={i} />
      <div className="cab2-plate">
        <span className="cab2-name">{m.name}</span>
        <span className="cab2-meta">{m.manufacturer} · {m.year}{N ? ` · ${N} played` : ''}</span>
      </div>
      <ol className="cab2-scores">
        {top.length ? top.map(s => (
          <li key={s.player.id} className={`r${Math.min(s.rank, 4)}`}>
            <span className="cab2-rank">{s.rank === 1 ? <Icon name="crown" size={15} stroke={2.2} /> : s.rank}</span>
            <Avatar avatar={s.player.avatar} emoji={s.player.emoji} name={s.player.display_name} color={s.player.color} size={20} />
            <span className="cab2-pname">{s.player.display_name}</span>
            <Dmd className="cab2-pscore" tone={s.rank === 1 ? 'hot' : undefined}>{fmtShort(s.score)}</Dmd>
          </li>
        )) : <li className="cab2-empty"><span>Be the first</span><span className="cab2-empty-sub">to post a score</span></li>}
        {top.length > 0 && Array.from({ length: Math.max(0, 10 - top.length) }, (_, k) => (
          <li key={`slot${k}`} className="slot"><span className="cab2-rank">{top.length + k + 1}</span><span className="slot-line" /></li>
        ))}
      </ol>
    </div>
  );
}
