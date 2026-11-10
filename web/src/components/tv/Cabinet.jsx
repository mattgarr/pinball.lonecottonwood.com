import Avatar from '../Avatar.jsx';
import Icon from '../Icon.jsx';
import Backbox from './Backbox.jsx';
import Dmd from './Dmd.jsx';
import { fmtShort } from '../../lib/scoring.js';
import { machineColors } from './theme.js';

// One machine column: lit backbox on top, name plate, then the top-10 like a high-score table.
// Lighting matches the garage strips: a score breathes player color ↔ machine color; a record
// cycles the machine's three colors.
export default function Cabinet({ entry, i, hot, hit }) {
  const { machine: m, top } = entry;
  const [c1, c2, c3] = machineColors(m.name);
  return (
    <div className={`cab2${hot ? ' hot' : ''}${hit ? ' hit' : ''}`}
      style={{ '--glow': c1, '--glow2': c2, '--glow3': c3, '--pc': hit?.player?.color || c1, '--i': i }}>
      <Backbox machine={m} i={i} />
      {hit && (
        <div className="cab2-hit" key={hit.id}>
          <div className="cab2-hit-label">
            {hit.rank === 1 ? 'TOP SCORE!' : hit.isClose ? 'SO CLOSE TO #1!' : hit.isPB ? '★ NEW BEST!' : 'JUST PLAYED'}
          </div>
          <Avatar avatar={hit.player.avatar} emoji={hit.player.emoji} name={hit.player.display_name} color={hit.player.color} size={56} ring />
          <div className="cab2-hit-name">{hit.player.display_name}</div>
          <Dmd tone="hot" className="cab2-hit-score">{fmtShort(hit.value)}</Dmd>
          {hit.rank ? <div className="cab2-hit-rank">#{hit.rank} HERE</div> : null}
        </div>
      )}
      <div className="cab2-plate">
        <span className="cab2-name">{m.name}</span>
        <span className="cab2-meta">{m.manufacturer} · {m.year}</span>
      </div>
      <ol className="cab2-scores">
        {top.length ? top.map(s => (
          <li key={s.player.id} className={`r${Math.min(s.rank, 4)}`}>
            <span className="cab2-rank">{s.rank === 1 ? <Icon name="crown" size={15} stroke={2.2} /> : s.rank}</span>
            <Avatar avatar={s.player.avatar} emoji={s.player.emoji} name={s.player.display_name} color={s.player.color} size={20} />
            <span className="cab2-pname">{s.player.display_name}</span>
            <Dmd className="cab2-pscore" tone={s.rank === 1 ? 'hot' : undefined}>{fmtShort(s.score)}</Dmd>
          </li>
        )) : <li className="cab2-empty"><span>Be the first</span><span className="cab2-empty-sub">to score</span></li>}
        {top.length > 0 && Array.from({ length: Math.max(0, 10 - top.length) }, (_, k) => (
          <li key={`slot${k}`} className="slot"><span className="cab2-rank">{top.length + k + 1}</span><span className="slot-line" /></li>
        ))}
      </ol>
    </div>
  );
}
