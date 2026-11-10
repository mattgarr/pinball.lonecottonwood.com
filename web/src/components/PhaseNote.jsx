import { useState } from 'react';
import { useParty, usePhase } from '../lib/store.js';
import { useNow } from '../lib/clock.js';
import { LOG_GRACE_MS, fmtClock, fmtCountdown, sealed } from '../lib/schedule.js';
import PixelEmoji from './PixelEmoji.jsx';
import '../freeplay.css';

// One line about the tournament right now, for the machine and Me pages.
export function PhaseNote({ compact = false }) {
  const { party } = useParty();
  const phase = usePhase();
  const now = useNow(compact ? 15000 : 1000);
  const ends = party?.tourney_ends_at ? Date.parse(party.tourney_ends_at) : null;
  let tone = 'fp', text = null;
  if (phase === 'pre') text = `Free play until ${fmtClock(party.tourney_starts_at)}: just for fun. The tournament starts then.`;
  else if (phase === 'free') text = "Free play: just for fun, doesn't change the tournament.";
  else if (phase === 'over') text = "Free play: the tournament is over, so new scores don't count.";
  else if (phase === 'grace') { tone = 'hot'; text = `Play's over! Log your last game now: it still counts for ${fmtCountdown(ends + LOG_GRACE_MS - now)}.`; }
  else if (phase === 'on' && ends) { tone = 'on'; text = `Tournament on: ends at ${fmtClock(party.tourney_ends_at)}.`; }
  if (!text) return null;
  return <div className={`phase-note ${tone}`} role="status">{text}</div>;
}

// After the end (and during the reveal): a full-screen "look at the TV" card. Guests can still
// close it and keep logging free play.
export function AwardsSoon() {
  const { party, me } = useParty();
  const phase = usePhase();
  const now = useNow(15000);
  const key = `${party?.current_event_id}:${party?.tourney_ends_at}:${party?.reveal_active ? 'r' : 'o'}`;
  const [closed, setClosed] = useState(null);
  const show = !!me && (phase === 'reveal' || (phase === 'over' && sealed(party, now)));
  if (!show || closed === key) return null;
  return (
    <div className="awards-soon" role="dialog" aria-label="Awards">
      <div className="awards-soon-box">
        <PixelEmoji e="🏆" size={72} grid={16} />
        <h1>{phase === 'reveal' ? 'Awards on now!' : 'Awards starting soon'}</h1>
        <p>Look at the TV{phase === 'reveal' ? '.' : ': results are sealed until the awards.'}</p>
        <button type="button" className="cta" onClick={() => setClosed(key)}>Keep playing (free play)</button>
      </div>
    </div>
  );
}

// "Results sealed" card for Ranks and Me.
export function SealedCard() {
  return (
    <section className="panel sealed-card">
      <PixelEmoji e="🔒" size={40} grid={16} />
      <div>
        <h3>Results sealed</h3>
        <div className="muted small">Awards soon. Watch the TV!</div>
      </div>
    </section>
  );
}
