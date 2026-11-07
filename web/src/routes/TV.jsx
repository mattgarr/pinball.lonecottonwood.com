import { useEffect, useRef, useState } from 'react';
import { useAwards, useStandings } from '../lib/store.js';
import QR from '../components/QR.jsx';
import Reveal from '../components/Reveal.jsx';
import Avatar from '../components/Avatar.jsx';
import Icon from '../components/Icon.jsx';
import { machineArt } from '../lib/machineArt.js';
import { fmtShort } from '../lib/scoring.js';
import { CountUp } from '../lib/useCountUp.js';

export default function TV() {
  const { machines, party, standings } = useStandings();
  const awards = useAwards(standings, party?.reveal_active ? party.match_digits : null);
  const [flash, setFlash] = useState({});
  const prev = useRef({});

  // Scale the fixed 1600x900 canvas to fill the screen.
  useEffect(() => {
    const apply = () => {
      const s = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
      document.documentElement.style.setProperty('--tv-scale', String(s));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => { window.removeEventListener('resize', apply); document.documentElement.style.removeProperty('--tv-scale'); };
  }, []);

  // Keep the TV awake where the browser allows it.
  useEffect(() => {
    let lock = null;
    const grab = () => navigator.wakeLock?.request('screen').then(l => { lock = l; }).catch(() => {});
    grab();
    const onVis = () => { if (!document.hidden) grab(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release?.(); };
  }, []);

  // Flash a player's row when their rating goes up.
  useEffect(() => {
    const next = {}, up = [];
    for (const st of standings.ranked) {
      next[st.player.id] = st.rating;
      if (prev.current[st.player.id] != null && st.rating > prev.current[st.player.id]) up.push(st.player.id);
    }
    prev.current = next;
    if (up.length) {
      const tok = Date.now();
      setFlash(f => ({ ...f, ...Object.fromEntries(up.map(id => [id, tok])) }));
      setTimeout(() => setFlash(f => { const c = { ...f }; up.forEach(id => { if (c[id] === tok) delete c[id]; }); return c; }), 1300);
    }
  }, [standings]);

  if (party?.reveal_active) {
    return <div className="tv-frame"><Reveal standings={standings} awards={awards} /></div>;
  }

  const joinURL = `${location.origin}/`;
  const champ = awards.champion;

  return (
    <div className="tv-frame">
      <div className="tv tv-floor">
        {party?.status === 'closed' && <div className="tv-closed-banner">Scoring closed · final standings</div>}

        <section className="floor-cabinets">
          {standings.machines.map(({ machine: m, top }) => (
            <div key={m.id} className="cab">
              <div className="cab-backbox">
                <img className="cab-art" src={machineArt(m.name)} alt={m.name} />
              </div>
              <ol className="cab-scores">
                {top.length ? top.map((s, i) => (
                  <li key={s.player.id} className={s.rank === 1 ? 'cab-champ' : ''}>
                    <span className="cab-rank">{s.rank === 1 ? <Icon name="crown" size={13} /> : s.rank}</span>
                    <Avatar avatar={s.player.avatar} emoji={s.player.emoji} name={s.player.display_name} color={s.player.color} size={19} />
                    <span className="cab-pname">{s.player.display_name}</span>
                    <span className="cab-pscore dmd">{fmtShort(s.score)}</span>
                  </li>
                )) : <li className="cab-empty">No scores yet</li>}
              </ol>
            </div>
          ))}
        </section>

        <div className="floor-bottom">
          <div className="board board-top">
            <div className="dash-head"><h2><span className="h-chip"><Icon name="crown" size={15} /></span>Top Players</h2>
              <div className="dash-sub">{standings.meta.totalPlayers} playing</div>
            </div>
            <div className="pboard">
              {standings.topPlayers.slice(0, 8).map(st => (
                <div key={st.player.id} className={`prow${st.rank === 1 ? ' lead' : ''}${flash[st.player.id] ? ' flash' : ''}`}>
                  <span className="prow-rank">{st.rank}</span>
                  <Avatar avatar={st.player.avatar} emoji={st.player.emoji} name={st.player.display_name} color={st.player.color} size={24} />
                  <span className="prow-name">{st.player.display_name}{st.player.first_timer && <span className="player-ft">NEW</span>}</span>
                  <span className="prow-crowns">{st.crowns > 0 && <><Icon name="crown" size={14} />{st.crowns > 1 ? <span className="crown-x">×{st.crowns}</span> : null}</>}</span>
                  <span className="prow-tables">{st.machinesPlayed}/{machines.length}</span>
                  <span className="prow-val dmd"><CountUp value={st.rating} /></span>
                </div>
              ))}
              {standings.topPlayers.length === 0 && <div className="board-empty">Play 2 machines to get on the board</div>}
            </div>
            <div className="tlegend">RATING = your average finish across the machines you played (100 = 1st on every one). Best score per machine counts; 2+ machines to be ranked.</div>
          </div>

          <div className="board board-shame">
            <div className="dash-head"><h2><span className="h-chip"><Icon name="skull" size={15} /></span>Wall of Shame</h2><div className="dash-sub">lowest</div></div>
            <div className="pboard">
              {standings.bottomPlayers.length ? standings.bottomPlayers.map((st, i) => (
                <div key={st.player.id} className="prow shame">
                  <span className="prow-rank">{i + 1}</span>
                  <Avatar avatar={st.player.avatar} emoji={st.player.emoji} name={st.player.display_name} color={st.player.color} size={24} />
                  <span className="prow-name">{st.player.display_name}</span>
                  <span className="prow-worst">{st.worst ? `${st.worst.rank}/${st.worst.N}` : ''}</span>
                  <span></span>
                  <span className="prow-val bad dmd">{st.rating}</span>
                </div>
              )) : <div className="board-empty">Nobody… yet</div>}
            </div>
            <div className="tlegend">Lowest ratings (2+ machines), never anyone on Top Players. Ranked with love. 💀</div>
          </div>

          <section className="floor-prizes">
            <div className="dash-head"><h2><span className="h-chip"><Icon name="medal" size={15} /></span>Prizes</h2></div>
            <div className="prize-list">
              <Prize icon="trophy" name="Overall Champion" crit="highest rating" who={champ?.player} stat={champ ? `${champ.rating}/100` : ''} />
              <Prize icon="star" name="Beginner's Luck" crit="best first-timer game" who={awards.beginnersLuck?.player}
                stat={awards.beginnersLuck ? `${awards.beginnersLuck.pct}% of top` : ''} />
              <Prize icon="grind" name="The Grinder" crit="most games played" who={awards.grinder?.player}
                stat={awards.grinder ? `${awards.grinder.plays} games` : ''} />
              <Prize icon="globe" name="Globetrotter" crit="played all 6 machines" who={awards.globetrotters?.[0]}
                stat={awards.globetrotters?.length ? `${awards.globetrotters.length} so far` : ''} />
              <Prize icon="burst" name="The Big Whiff" crit="lowest rating" who={awards.bigWhiff?.player}
                stat={awards.bigWhiff ? `${awards.bigWhiff.rating}/100` : ''} dim />
              <Prize icon="ticket" name="The Match" crit="last 2 digits match the draw" stat="at the end" pending />
            </div>
          </section>

          <section className="floor-qr">
            <QR value={joinURL} size={170} />
            <div className="floor-qr-text">
              <div className="floor-qr-label">SCAN TO PLAY</div>
              <div className="qr-url">{location.host}</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Prize({ icon, name, crit, who, stat, pending, dim }) {
  return (
    <div className={`prize${pending ? ' pending' : ''}${dim ? ' dim' : ''}`}>
      <span className="prize-icon"><Icon name={icon} size={18} /></span>
      <div className="prize-body">
        <div className="prize-top">
          <span className="prize-name">{name}</span>
          <span className="prize-stat">{stat}</span>
        </div>
        <div className="prize-sub">
          <span className="prize-crit">{crit}</span>
          {!pending && <span className="prize-sep">·</span>}
          {!pending && (who ? (
            <span className="prize-leader">
              <Avatar avatar={who.avatar} emoji={who.emoji} name={who.display_name} color={who.color} size={15} />
              <span className="prize-who">{who.display_name}</span>
            </span>
          ) : <span className="prize-who muted">up for grabs</span>)}
        </div>
      </div>
    </div>
  );
}
