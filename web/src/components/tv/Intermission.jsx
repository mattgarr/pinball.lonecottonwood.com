import Avatar from '../Avatar.jsx';
import Dmd from './Dmd.jsx';
import { PRIZE_COUNT } from '../Reveal.jsx';

// A small badge + note under the TV logo ("PLAY OVER", "FINAL RESULTS", "RESULTS SEALED", …), in place of
// the countdown chip. children: something to show after the badge instead of the note (e.g. the chip).
export function StatusBadge({ tone = 'gold', badge, note = '', children = null }) {
  return (
    <span className="fp-sub tv-status">
      <span className={`fp-badge ${tone}`}>{badge}</span>
      {children || (note ? <span className={`fp-note ${tone}`}>{note}</span> : null)}
    </span>
  );
}

// The intermission: from the end of the tournament (+ the 3 minutes to log the last game) until the host
// starts the reveal. The results are sealed, so nothing here gives away a winner: just that it's over,
// how big the night was, everyone who's in the running, and "gather round, awards soon".
export function Intermission({ standings, players, event, ticker }) {
  const inRunning = [...standings.stats.values()].filter(st => st.plays > 0).map(st => st.player)
    .sort((a, b) => a.id - b.id);
  const shown = inRunning.slice(0, 72);
  const games = standings.meta.totalScores;
  return (
    <>
      <header className="tv2-head">
        <div className="tv2-brand">
          <span className="tv2-logo">WOODSIDE <b>PINBALL</b></span>
          <StatusBadge tone="gold" badge="Results sealed" note="Awards soon" />
        </div>
        {ticker}
      </header>

      <section className="im-stage" aria-label="Intermission">
        <div className="im-kicker">Game over · {event?.name || 'the tournament'}</div>
        <div className="im-title">THE RESULTS ARE IN</div>
        <div className="im-call">Awards ceremony starting soon · gather round the TV!</div>
        <div className="im-stats">
          <div className="im-stat"><Dmd ghost tone="hot" className="im-num">{inRunning.length}</Dmd><span className="im-lab">players</span></div>
          <div className="im-stat"><Dmd ghost tone="hot" className="im-num">{games}</Dmd><span className="im-lab">games</span></div>
          <div className="im-stat"><Dmd ghost tone="hot" className="im-num">{PRIZE_COUNT}</Dmd><span className="im-lab">prizes</span></div>
        </div>
        {shown.length > 0 && (
          <>
            <div className="im-label">In the running</div>
            <ul className={`im-wall${shown.length > 40 ? ' dense' : ''}`}>
              {shown.map(p => (
                <li key={p.id} title={p.display_name}>
                  <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={shown.length > 40 ? 40 : 52} />
                </li>
              ))}
              {inRunning.length > shown.length && <li className="im-more">+{inRunning.length - shown.length}</li>}
            </ul>
          </>
        )}
        <div className="im-foot">
          <span>Not here for the awards? A friend can accept for you.</span>
          <span className="im-fp">Free play is open: scores now are just for fun.</span>
        </div>
      </section>
    </>
  );
}
