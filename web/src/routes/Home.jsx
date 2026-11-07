import { Link, useNavigate } from 'react-router-dom';
import { useStandings } from '../lib/store.js';
import { machineArt } from '../lib/machineArt.js';
import { MIN_TABLES, ordinal } from '../lib/scoring.js';

export default function Home() {
  const { machines, me, standings, party } = useStandings();
  const nav = useNavigate();
  const mine = me ? standings.stats.get(me.id) : null;
  const ranked = standings.meta.rankedPlayers;

  return (
    <div className="screen">
      {party?.status === 'closed' && <div className="err">Scoring is closed. Final standings are on the TV.</div>}

      {mine && (
        <Link to="/me" className="progress-card">
          <div>
            <div className="progress-label">Your rating</div>
            <div className="progress-big">
              {mine.rating != null ? <>{mine.rating}<span className="muted small">/100</span></> : '—'}
            </div>
          </div>
          <div className="progress-side">
            {mine.rating != null
              ? <>{ordinal(mine.rank)} of {ranked}</>
              : mine.machinesPlayed === 0
                ? 'Play any machine to get started'
                : `Play ${MIN_TABLES - mine.machinesPlayed} more machine to get ranked`}
            <div className="muted small">{mine.machinesPlayed}/{machines.length} machines · {mine.plays} games · My progress →</div>
          </div>
        </Link>
      )}

      <h1>Pick a machine</h1>
      <p className="muted">Tap one to log a score, or scan the QR on the machine. New to pinball? <Link to="/about" className="link">Read this first →</Link></p>
      <div className="machine-grid">
        {machines.map(m => {
          const pm = mine?.perMachine[m.id];
          return (
            <div key={m.id} className="machine-card" role="button" tabIndex={0}
              onClick={() => nav(`/machine/${m.id}`)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') nav(`/machine/${m.id}`); }}
            >
              <div className="machine-art-wrap">
                <img className="machine-art" src={machineArt(m.name)} alt="" loading="lazy" />
                {pm && <span className={`machine-badge${pm.rank === 1 ? ' gold' : ''}`}>{pm.rank === 1 ? '👑 ' : ''}{ordinal(pm.rank)}/{pm.N}</span>}
              </div>
              <div className="machine-body">
                <div className="machine-name">{m.name}</div>
                <div className="machine-meta">{m.manufacturer} · {m.year}</div>
                {!pm && <div className="machine-display">not played yet</div>}
                <Link to={`/machine/${m.id}/guide`} className="machine-guide-link" onClick={e => e.stopPropagation()}>📖 guide</Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
