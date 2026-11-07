import { Link } from 'react-router-dom';
import { useStandings } from '../lib/store.js';
import { machineArt } from '../lib/machineArt.js';
import { MIN_TABLES, fmtShort, ordinal } from '../lib/scoring.js';
import Avatar from '../components/Avatar.jsx';

export default function Home() {
  const { machines, me, standings, party } = useStandings();
  const mine = me ? standings.stats.get(me.id) : null;
  const ranked = standings.meta.rankedPlayers;
  const closed = party?.status === 'closed';

  return (
    <div className="screen home">
      {mine && (
        <Link to="/me" className="rating-strip" aria-label="My progress">
          <Avatar avatar={me.avatar} emoji={me.emoji} name={me.display_name} color={me.color} size={38} ring />
          <div className="rs-main">
            <div className="rs-label">{mine.rating != null ? 'Your rating' : 'Get ranked'}</div>
            <div className="rs-line">
              {mine.rating != null ? (
                <><span className="rs-num">{mine.rating}</span><span className="rs-rank">{ordinal(mine.rank)} of {ranked}</span></>
              ) : (
                <span className="rs-todo">
                  {mine.machinesPlayed === 0 ? 'Play any machine to start' : `Play ${MIN_TABLES - mine.machinesPlayed} more machine`}
                </span>
              )}
            </div>
          </div>
          <div className="rs-dots" aria-label={`${mine.machinesPlayed} of ${machines.length} machines played`}>
            {machines.map(m => {
              const pm = mine.perMachine[m.id];
              return <span key={m.id} className={`rs-dot${pm ? (pm.rank === 1 ? ' gold' : ' on') : ''}`} />;
            })}
          </div>
          <span className="rs-go" aria-hidden="true">›</span>
        </Link>
      )}

      {closed && <div className="err">Scoring is closed. Final standings are on the TV.</div>}

      <div className="home-head">
        <h1>Pick a machine</h1>
        <div className="muted small">Tap the one you just played, or scan its QR. New to pinball? <Link to="/about" className="link">Start here</Link></div>
      </div>

      <div className="mgrid">
        {machines.map((m, i) => {
          const pm = mine?.perMachine[m.id];
          const champ = standings.machines.find(x => x.machine.id === m.id)?.champion;
          return (
            <Link key={m.id} to={`/machine/${m.id}`} className={`mcard${pm?.rank === 1 ? ' crowned' : ''}`} style={{ animationDelay: `${i * 40}ms` }}>
              <img className="mcard-img" src={machineArt(m.name)} alt="" loading={i < 4 ? 'eager' : 'lazy'} decoding="async" />
              <div className="mcard-shade" />
              {pm ? (
                <span className={`mcard-badge${pm.rank === 1 ? ' gold' : ''}`}>{pm.rank === 1 ? '👑 1st' : `${ordinal(pm.rank)}/${pm.N}`}</span>
              ) : (
                <span className="mcard-badge new">NEW</span>
              )}
              <div className="mcard-text">
                <div className="mcard-name">{m.name}</div>
                <div className="mcard-meta">
                  {pm ? <>best <span className="amber mono">{fmtShort(pm.best)}</span></> : `${m.manufacturer} · ${m.year}`}
                </div>
                {champ && champ.player.id !== me?.id && (
                  <div className="mcard-champ">👑 {champ.player.display_name} {fmtShort(champ.score)}</div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
