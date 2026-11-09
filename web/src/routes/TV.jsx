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
import Crawl from '../components/tv/Crawl.jsx';
import { BOARD_N, useLiveEvents } from '../components/tv/useLiveEvents.js';
import { sfx, sound } from '../lib/chiptune.js';
import { CountUp } from '../lib/useCountUp.js';
import { fmtShort } from '../lib/scoring.js';
import '../tv.css';

export default function TV() {
  const { machines, players, scores, party, ready, standings, event } = useStandings();
  const awards = useAwards(standings, party?.reveal_active ? party.match_digits : null);
  const demo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');
  const live = useLiveEvents({ standings, scores, players, ready, demo });
  const [soundOn, setSoundOn] = useState(false);
  const [attract, setAttract] = useState(false);
  const lastEvent = useRef(Date.now());
  // Show the mouse cursor while it moves; hide it after 3 s of stillness.
  const [cursor, setCursor] = useState(false);
  useEffect(() => {
    let t;
    const move = () => { setCursor(true); clearTimeout(t); t = setTimeout(() => setCursor(false), 3000); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mousedown', move);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mousedown', move); clearTimeout(t); };
  }, []);
  const [flash, setFlash] = useState({});
  // Top Players: the top 3 stay pinned; everyone else pages through below them, a few at a time.
  const PINNED = 3, PAGE = BOARD_N - PINNED;
  const restCount = Math.max(0, standings.ranked.length - PINNED);
  const pages = Math.max(1, Math.ceil(restCount / PAGE));
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (pages < 2) { setPage(0); return; }
    const iv = setInterval(() => setPage(p => (p + 1) % pages), 6000);
    return () => clearInterval(iv);
  }, [pages]);
  const pg = page % pages;
  const boardRows = [...standings.ranked.slice(0, PINNED), ...standings.ranked.slice(PINNED + pg * PAGE, PINNED + (pg + 1) * PAGE)];
  const pgFrom = PINNED + pg * PAGE + 1, pgTo = Math.min(standings.ranked.length, PINNED + (pg + 1) * PAGE);
  const pageLabel = pages > 1 ? ` · ${pgFrom === pgTo ? pgFrom : `${pgFrom}–${pgTo}`}` : '';
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
    if (!tk?.machine) return; // leader takeovers aren't about one machine
    const id = tk.machine.id;
    setHot(h => ({ ...h, [id]: true }));
    const t = setTimeout(() => setHot(h => { const c = { ...h }; delete c[id]; return c; }), 20000);
    return () => clearTimeout(t);
  }, [tk]);

  // Sound effects for each new event (only after someone clicks the TV once).
  const toast = live.toast;
  useEffect(() => { if (tk) { lastEvent.current = Date.now(); (tk.kind === 'leader' ? sfx.leader : sfx.record)(); } }, [tk?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast || tk) return;
    lastEvent.current = Date.now();
    ({ join: sfx.join, climb: sfx.climb, enter: sfx.climb, shame: sfx.shame, milestone: sfx.milestone }[toast.kind] || sfx.climb)();
  }, [toast?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const hitKey = Object.values(live.hits).map(h => h.id).sort().join('|');
  useEffect(() => { if (hitKey && !tk) { lastEvent.current = Date.now(); sfx.coin(); } }, [hitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Attract mode: after a quiet minute, the cabinets run a light chase every 40 s.
  useEffect(() => {
    const iv = setInterval(() => {
      if (Date.now() - lastEvent.current < 60000) return;
      setAttract(true);
      setTimeout(() => setAttract(false), 4000);
    }, 40000);
    return () => clearInterval(iv);
  }, []);

  async function toggleSound() {
    if (sound.isOn()) { sound.disable(); setSoundOn(false); }
    else { await sound.enable(); setSoundOn(true); }
  }

  if (party?.reveal_active) {
    return <div className={`tv-frame tv2-frame${cursor ? ' show-cursor' : ''}`}><Reveal standings={standings} awards={awards} /></div>;
  }

  const joinURL = `${location.origin}/`;
  const champ = awards.champion;

  return (
    <div className={`tv-frame tv2-frame${cursor ? ' show-cursor' : ''}`} onClick={() => { if (!sound.isOn()) toggleSound(); }}>
      <div className="tv tv2">
        <div className="tv2-drift">
          {party?.status === 'closed' && <div className="tv2-closed">Scoring closed · final standings</div>}

          <header className="tv2-head">
            <div className="tv2-brand">
              <span className="tv2-logo">WOODSIDE <b>PINBALL</b></span>
              {/* Brand on top (same for every event); the current event's own name underneath. */}
              <span className="tv2-stats tv2-event">{event?.name || `${standings.meta.totalPlayers} players · ${standings.meta.totalScores} games`}</span>
            </div>
            <Ticker scores={scores} players={players} machines={machines} n={8} />
          </header>

          <section className={`tv2-cabs${attract ? ' attract' : ''}`}>
            {standings.machines.map((entry, i) => (
              <Cabinet key={entry.machine.id} entry={entry} i={i} hot={!!hot[entry.machine.id]} hit={live.hits[entry.machine.id]} />
            ))}
          </section>

          <div className="tv2-bottom">
            <div className="pnl pnl-top">
              <PanelHead icon="crown" title="Top Players" sub={`${standings.meta.rankedPlayers} ranked${pageLabel}`} />
              <div className="pb">
                {boardRows.map((st, i) => (
                  <div key={i < PINNED ? st.player.id : `${pg}-${st.player.id}`} className={`pr${st.rank <= 3 ? ` p${st.rank}` : ''}${i >= PINNED && pages > 1 ? ' paged' : ''}${flash[st.player.id] ? ' flash' : ''}`}>
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
              <div className="pnl-legend">Avg finish · 2+ machines to rank</div>
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

            <PrizePanel awards={awards} />

            <section className="pnl pnl-qr">
              <div className="qr-label">SCAN TO PLAY</div>
              <div className="qr-box"><QR value={joinURL} size={150} light="#e9e9e9" /></div>
              <div className="qr-url">{location.host}</div>
            </section>
          </div>

          <Crawl standings={standings} awards={awards} news={live.news} machines={machines} />

          {live.toast && <Toast key={live.toast.id} item={live.toast} onDone={live.nextToast} paused={!!tk} />}
        </div>

        {tk && <Takeover key={tk.id} item={tk} queued={live.queued} onDone={live.nextTakeover} />}
        <button type="button" className={`tv-sound${soundOn ? ' on' : ''}`} onClick={e => { e.stopPropagation(); toggleSound(); }}>
          {soundOn ? '⚙ Sound effects: on (click to mute)' : '⚙ Sound effects: off (click to turn on)'}
        </button>
        {demo && <div className="tv-demo">DEMO</div>}
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

// The prize panel alternates between two pages: the overall prizes, then a champion for each machine.
// One prize per person, so a machine's prize can go to the next in line (see computeAwards).
const PRIZE_PAGE_MS = 8000;
function PrizePanel({ awards }) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPage(p => 1 - p), PRIZE_PAGE_MS);
    return () => clearInterval(t);
  }, []);
  const st = (x, f) => (x ? f(x) : '');
  return (
    <section className="pnl pnl-prizes">
      <PanelHead icon="medal" title="Prizes" sub={page === 0 ? 'overall 1/2' : 'machines 2/2'} />
      <div className="pz-list" key={page}>
        {page === 0 ? <>
          <Prize icon="trophy" name="Grand Champion" crit="best rating" who={awards.champion?.player} stat={st(awards.champion, c => `${c.rating}/100`)} gold />
          <Prize icon="medal" name="2nd Place" crit="2nd-best rating" who={awards.second?.player} stat={st(awards.second, c => `${c.rating}/100`)} />
          <Prize icon="medal" name="3rd Place" crit="3rd-best rating" who={awards.third?.player} stat={st(awards.third, c => `${c.rating}/100`)} />
          <Prize icon="grind" name="The Grinder" crit="most games" who={awards.grinder?.player} stat={st(awards.grinder, g => `${g.plays} games`)} />
          <Prize icon="burst" name="The Big Whiff" crit="lowest rating" who={awards.bigWhiff?.player} stat={st(awards.bigWhiff, w => `${w.rating}/100`)} dim />
          <Prize icon="ticket" name="The Match" crit="random draw" stat="at the end" pending />
        </> : (awards.machineChamps ?? []).map(c => (
          <Prize key={c.machine.id} icon="crown" name={c.machine.name} crit={c.player && c.rank > 1 ? 'next in line' : 'top score'}
            who={c.player} stat={c.player ? fmtShort(c.score) : ''} />
        ))}
      </div>
    </section>
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
