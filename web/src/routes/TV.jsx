import { useEffect, useRef, useState } from 'react';
import { useAwards, useStandings } from '../lib/store.js';
import QR from '../components/QR.jsx';
import Reveal from '../components/Reveal.jsx';
import Avatar from '../components/Avatar.jsx';
import Icon from '../components/Icon.jsx';
import Cabinet from '../components/tv/Cabinet.jsx';
import Ticker from '../components/tv/Ticker.jsx';
import Takeover from '../components/tv/Takeover.jsx';
import Toast from '../components/tv/Toast.jsx';
import Dmd from '../components/tv/Dmd.jsx';
import { BOARD_N, useLiveEvents } from '../components/tv/useLiveEvents.js';
import { CountUp } from '../lib/useCountUp.js';
import '../tv.css';

export default function TV() {
  const { machines, players, scores, party, ready, standings } = useStandings();
  const awards = useAwards(standings, party?.reveal_active ? party.match_digits : null);
  const live = useLiveEvents(standings, ready);
  const [flash, setFlash] = useState({});
  const [hot, setHot] = useState({}); // machineId -> true while its cabinet celebrates
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
      setTimeout(() => setFlash(f => { const c = { ...f }; up.forEach(id => { if (c[id] === tok) delete c[id]; }); return c; }), 1600);
    }
  }, [standings]);

  // After a takeover, the cabinet it was about keeps glowing hot for a little while.
  const tk = live.takeover;
  useEffect(() => {
    if (!tk) return;
    const id = tk.machine.id;
    setHot(h => ({ ...h, [id]: true }));
    const t = setTimeout(() => setHot(h => { const c = { ...h }; delete c[id]; return c; }), 20000);
    return () => clearTimeout(t);
  }, [tk]);

  if (party?.reveal_active) {
    return <div className="tv-frame tv2-frame"><Reveal standings={standings} awards={awards} /></div>;
  }

  const joinURL = `${location.origin}/`;
  const champ = awards.champion;

  return (
    <div className="tv-frame tv2-frame">
      <div className="tv tv2">
        <div className="tv2-drift">
          {party?.status === 'closed' && <div className="tv2-closed">Scoring closed · final standings</div>}

          <header className="tv2-head">
            <div className="tv2-brand">
              <span className="tv2-logo">PINBALL<b>WIZARD</b></span>
              <span className="tv2-stats">{standings.meta.totalPlayers} players · {standings.meta.totalScores} games</span>
            </div>
            <Ticker scores={scores} players={players} machines={machines} n={8} />
          </header>

          <section className="tv2-cabs">
            {standings.machines.map((entry, i) => (
              <Cabinet key={entry.machine.id} entry={entry} i={i} hot={!!hot[entry.machine.id]} />
            ))}
          </section>

          <div className="tv2-bottom">
            <div className="pnl pnl-top">
              <PanelHead icon="crown" title="Top Players" sub={`${standings.meta.rankedPlayers} ranked`} />
              <div className="pb">
                {standings.topPlayers.slice(0, BOARD_N).map(st => (
                  <div key={st.player.id} className={`pr${st.rank <= 3 ? ` p${st.rank}` : ''}${flash[st.player.id] ? ' flash' : ''}`}>
                    <span className="pr-rank">{st.rank}</span>
                    <Avatar avatar={st.player.avatar} emoji={st.player.emoji} name={st.player.display_name} color={st.player.color} size={24} />
                    <span className="pr-name">{st.player.display_name}{st.player.first_timer && <span className="pr-ft">NEW</span>}</span>
                    <span className="pr-crowns">{st.crowns > 0 && <><Icon name="crown" size={15} stroke={2.2} />{st.crowns > 1 ? <span>×{st.crowns}</span> : null}</>}</span>
                    <span className="pr-tables">{st.machinesPlayed}/{machines.length}</span>
                    <Dmd className="pr-val" tone={st.rank === 1 ? 'hot' : undefined}><CountUp value={st.rating} /></Dmd>
                  </div>
                ))}
                {standings.topPlayers.length === 0 && <div className="pnl-empty">Play 2 machines to rank</div>}
              </div>
              <div className="pnl-legend">RATING = avg finish. 100 = 1st on all. Play 2+ to rank.</div>
            </div>

            <div className="pnl pnl-shame">
              <PanelHead icon="skull" title="Wall of Shame" sub="lowest" />
              <div className="pb">
                {standings.bottomPlayers.length ? standings.bottomPlayers.map((st, i) => (
                  <div key={st.player.id} className="pr shame">
                    <span className="pr-rank">{i + 1}</span>
                    <Avatar avatar={st.player.avatar} emoji={st.player.emoji} name={st.player.display_name} color={st.player.color} size={24} />
                    <span className="pr-name">{st.player.display_name}</span>
                    <span className="pr-worst">{st.worst ? `${st.worst.rank}/${st.worst.N}` : ''}</span>
                    <Dmd className="pr-val" tone="red">{st.rating}</Dmd>
                  </div>
                )) : <div className="pnl-empty">Nobody… yet</div>}
              </div>
              <div className="pnl-legend">Ranked with love. 💀</div>
            </div>

            <section className="pnl pnl-prizes">
              <PanelHead icon="medal" title="Prizes" />
              <div className="pz-list">
                <Prize icon="trophy" name="Overall Champion" crit="highest rating" who={champ?.player} stat={champ ? `${champ.rating}/100` : ''} gold />
                <Prize icon="star" name="Beginner's Luck" crit="best first-timer" who={awards.beginnersLuck?.player}
                  stat={awards.beginnersLuck ? `${awards.beginnersLuck.pct}% of top` : ''} />
                <Prize icon="grind" name="The Grinder" crit="most games" who={awards.grinder?.player}
                  stat={awards.grinder ? `${awards.grinder.plays} games` : ''} />
                <Prize icon="globe" name="Globetrotter" crit={`played all ${machines.length || 6}`} who={awards.globetrotters?.[0]}
                  stat={awards.globetrotters?.length ? `${awards.globetrotters.length} so far` : ''} />
                <Prize icon="burst" name="The Big Whiff" crit="lowest rating" who={awards.bigWhiff?.player}
                  stat={awards.bigWhiff ? `${awards.bigWhiff.rating}/100` : ''} dim />
                <Prize icon="ticket" name="The Match" crit="last 2 digits" stat="at the end" pending />
              </div>
            </section>

            <section className="pnl pnl-qr">
              <div className="qr-label">SCAN TO PLAY</div>
              <div className="qr-box"><QR value={joinURL} size={150} light="#e9e9e9" /></div>
              <div className="qr-url">{location.host}</div>
            </section>
          </div>

          {live.toast && <Toast key={live.toast.id} item={live.toast} onDone={live.nextToast} paused={!!tk} />}
        </div>

        {tk && <Takeover key={tk.id} item={tk} queued={live.queued} onDone={live.nextTakeover} />}
      </div>
    </div>
  );
}

function PanelHead({ icon, title, sub }) {
  return (
    <div className="pnl-head">
      <h2><span className="pnl-chip"><Icon name={icon} size={16} stroke={2.1} /></span>{title}</h2>
      {sub && <span className="pnl-sub">{sub}</span>}
    </div>
  );
}

function Prize({ icon, name, crit, who, stat, pending, dim, gold }) {
  return (
    <div className={`pz${pending ? ' pending' : ''}${dim ? ' dim' : ''}${gold ? ' gold' : ''}`}>
      <span className="pz-icon"><Icon name={icon} size={19} stroke={2} /></span>
      <div className="pz-body">
        <div className="pz-top">
          <span className="pz-name">{name}</span>
          <span className="pz-stat">{stat}</span>
        </div>
        <div className="pz-sub">
          {!pending && (who ? (
            <span className="pz-leader">
              <Avatar avatar={who.avatar} emoji={who.emoji} name={who.display_name} color={who.color} size={18} />
              <span className="pz-who">{who.display_name}</span>
            </span>
          ) : <span className="pz-who muted">up for grabs</span>)}
          {!pending && <span className="pz-sep">·</span>}
          <span className="pz-crit">{crit}</span>
        </div>
      </div>
    </div>
  );
}
