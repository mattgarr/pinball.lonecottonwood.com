import { Link } from 'react-router-dom';
import { useStandings } from '../lib/store.js';
import { machineArt } from '../lib/machineArt.js';
import { MIN_TABLES, fmtShort, ordinal } from '../lib/scoring.js';
import Avatar from '../components/Avatar.jsx';

export default function Home() {
  const { machines, me, standings, party, event } = useStandings();
  const mine = me ? (standings.stats.get(me.id) || {
    player: me, plays: 0, machinesPlayed: 0, perMachine: {}, rating: null, rank: null,
  }) : null;
  const ranked = standings.meta.rankedPlayers;
  const closed = party?.status === 'closed';

  return (
    <div className="screen home">
      {mine && (
        <Link to="/ranks" className="rating-strip" aria-label="My rank">
          <Avatar avatar={me.avatar} emoji={me.emoji} name={me.display_name} color={me.color} size={38} ring />
          <div className="rs-main">
            <div className="rs-label">{mine.rating != null ? 'Rating' : 'Get ranked'}</div>
            <div className="rs-line">
              {mine.rating != null ? (
                <><span className="rs-num">{mine.rating}</span><span className="rs-rank">{ordinal(mine.rank)} of {ranked}</span></>
              ) : (
                <span className="rs-todo">
                  {mine.machinesPlayed === 0 ? 'PLAY ANY MACHINE' : `${MIN_TABLES - mine.machinesPlayed} MORE MACHINE${MIN_TABLES - mine.machinesPlayed === 1 ? '' : 'S'}`}
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

      {closed && <div className="err">Scoring's closed. Finals on the TV.</div>}

      <div className="home-head">
        {event && <div className="event-chip">{event.name}</div>}
        <h1>Pick your machine</h1>
        <div className="muted small">First time here? <Link to="/about" className="link">How the party works</Link></div>
      </div>

      <div className="mgrid">
        {machines.map((m, i) => {
          const pm = mine?.perMachine[m.id];
          const champ = standings.machines.find(x => x.machine.id === m.id)?.champion;
          return (
            <Link key={m.id} to={`/machine/${m.id}`} className={`mcard${pm?.rank === 1 ? ' crowned' : ''}`} style={{ animationDelay: `${i * 40}ms` }}>
              <img className="mcard-img" src={machineArt(m.name)} alt="" loading={i < 4 ? 'eager' : 'lazy'} decoding="async" />
              <div className="mcard-shade" />
              <div className="mcard-text">
                <div className="mcard-top">
                  {pm ? (
                    <span className={`mcard-badge${pm.rank === 1 ? ' gold' : ''}`}>{pm.rank === 1 ? '👑 1st' : `${ordinal(pm.rank)}/${pm.N}`}</span>
                  ) : (
                    <span className="mcard-badge new">PLAY ME!</span>
                  )}
                </div>
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
