import { useEffect, useMemo, useRef, useState } from 'react';
import { ensureLightsTopic, getHostPass, host, useAwards, useNightStandings, useParty, usePhase, useStandings } from '../lib/store.js';
import { serverNow, useNow } from '../lib/clock.js';
import { SEAL_MS, dueClockMoment, finalSeconds, fmtClock, revealedAfterEnd, sealed } from '../lib/schedule.js';
import ClockChip from '../components/tv/ClockChip.jsx';
import { FinalCountdown } from '../components/tv/Takeover.jsx';
import { useLightsDirector } from '../lib/lights/useLightsDirector.js';
import QR from '../components/QR.jsx';
import { partyUrl } from '../lib/access.js';
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
import { computeHighScores, fmtShort } from '../lib/scoring.js';
import '../tv.css';

export default function TV() {
  const { machines, players, scores, party, ready, standings, event } = useStandings();
  const demo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');
  const revealPreview = typeof location !== 'undefined' && new URLSearchParams(location.search).has('reveal');
  // A preview (/tv?reveal, or ?reveal=40) draws its own Match number; the real reveal uses the host's draw.
  const [previewDraw] = useState(() => {
    const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('reveal') : '';
    return /^\d{1,2}$/.test(v || '') ? Number(v) : Math.floor(Math.random() * 10) * 10;
  });
  const awards = useAwards(standings, party?.reveal_active ? party.match_digits : revealPreview ? previewDraw : null);
  const { lights: lightsSettings } = useParty();
  useEffect(() => { ensureLightsTopic(); }, []); // learns the lights channel if this browser has the host unlock
  // Garage lights: only the screen marked as the lights driver (the TV on the Mac) sends anything.
  // /tv?lights=sim (the simulator's TV view) drives the simulated strips only, including demo events.
  const lightsSim = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lights') === 'sim';
  // /tv?demo&lights=1: rehearsal, the demo's moments drive the real strips (normally demo never does).
  const lightsRehearsal = (demo || revealPreview) && new URLSearchParams(location.search).get('lights') === '1';
  // The simulator's TV view passes its own private channel (?ch=…), so test pages don't light up each other.
  const simCh = lightsSim ? (new URLSearchParams(location.search).get('ch') || '').replace(/[^a-z0-9]/gi, '').slice(0, 16) : '';
  const lights = useLightsDirector({ settings: lightsSettings, party, scores, players, standings, ready: ready && (!(demo || revealPreview) || lightsSim || lightsRehearsal), simOnly: lightsSim, simChannel: simCh ? `~/wpsim/${simCh}` : null });
  // Free play (before the tournament, and after the awards): the high score board. /tv?freeplay
  // previews it locally (?freeplay=pre: the pre-tournament version with a countdown).
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const fpParam = params.get('freeplay');
  const livePhase = usePhase();
  const phase = fpParam != null ? (fpParam === 'pre' ? 'pre' : 'free') : livePhase;
  const fpBoard = phase === 'pre' || phase === 'free';
  const night = useNightStandings();
  // The tournament board only reacts to tournament scores (free play during 'over' or the reveal stays quiet).
  const tScores = useMemo(() => scores.filter(x => !x.free_play), [scores]);
  const nowMs = serverNow();
  const sealedParam = params.has('sealed');
  const isSealed = sealedParam || (!revealPreview && sealed(party, nowMs));
  const endsMs = party?.tourney_ends_at ? Date.parse(party.tourney_ends_at) : null;
  const lastCall = phase === 'on' && !!endsMs && endsMs - nowMs <= SEAL_MS;
  const live = useLiveEvents({ standings: fpBoard ? night : standings, scores: fpBoard ? scores : tScores, players, ready, demo, freePlay: fpBoard, sealed: isSealed, lastCall });
  const prevPhase = useRef(phase);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if ((was === 'grace' || was === 'over') && (phase === 'on' || phase === 'free')) lights.onClock?.('resume');
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const highScores = useMemo(() => computeHighScores({ machines, players, scores, n: FP_ROWS }), [machines, players, scores]);
  // Previews: ?clock=start:5 / end:15 / start:0 / end:0 shows that takeover; ?clock=final the last-10-seconds count;
  // ?chip=start / end shows the countdown chip.
  const clockParam = params.get('clock');
  const chipParam = params.get('chip') || (fpParam === 'pre' ? 'start' : null);
  const chipPreview = chipParam ? { kind: chipParam === 'end' ? 'end' : 'start', ms: chipParam === 'end' ? 8 * 60000 + 21000 : 12 * 60000 + 34000 } : null;
  useClockMoments({ party, ready: ready && !demo && !revealPreview && !clockParam, push: live.pushTakeover });
  useEffect(() => {
    const m = /^(start|end):(\d+)$/.exec(clockParam || '');
    if (m && ready) live.pushTakeover({ kind: 'clock', id: `preview-${clockParam}`, side: m[1], minutes: Number(m[2]), target: 0, pinned: true });
  }, [ready, clockParam]); // eslint-disable-line react-hooks/exhaustive-deps
  // The garage lights follow what's on screen, as it appears.
  // Clock cards use existing light moments: a minute mark = the gold bounce, the start / end = a burst.
  useEffect(() => {
    const t = live.takeover;
    if (!t) return;
    if (t.kind !== 'clock') lights.onTakeover(t);
    else lights.onClock?.(t.minutes ? 'mark' : t.side === 'start' ? 'start' : 'gameover');
  }, [live.takeover?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (live.toast) lights.onToast(live.toast); }, [live.toast?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // In the lights simulator's TV view, the simulator's event buttons show their moment here.
  useEffect(() => {
    if (!lightsSim) return undefined;
    const on = e => { if (e.origin === location.origin && e.data?.type === 'pw-sim') live.inject(e.data.kind, e.data.machineId); };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [lightsSim, live.inject]); // eslint-disable-line react-hooks/exhaustive-deps
  const litHits = useRef(new Set());
  useEffect(() => {
    for (const h of Object.values(live.hits)) {
      if (litHits.current.has(h.id)) continue;
      litHits.current.add(h.id);
      lights.onHit(h);
    }
  }, [live.hits]); // eslint-disable-line react-hooks/exhaustive-deps
  const [soundOn, setSoundOn] = useState(false);
  const [attract, setAttract] = useState(false);
  const lastEvent = useRef(Date.now());
  // Show the mouse cursor while it moves; hide it after 3 s of stillness.
  // The sound / lights buttons appear only while the mouse is in the bottom-right corner.
  const [cursor, setCursor] = useState(false);
  const [controls, setControls] = useState(false);
  useEffect(() => {
    let t, tc;
    const move = ev => {
      setCursor(true); clearTimeout(t); t = setTimeout(() => setCursor(false), 3000);
      if (ev.clientX > window.innerWidth - 480 && ev.clientY > window.innerHeight - 220) {
        setControls(true); clearTimeout(tc); tc = setTimeout(() => setControls(false), 3000);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mousedown', move);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mousedown', move); clearTimeout(t); clearTimeout(tc); };
  }, []);
  const [flash, setFlash] = useState({});
  // Top Players: the top 3 stay pinned; everyone else pages through below them, plus up to 3 "1 machine away" players.
  const PINNED = 3, PAGE = BOARD_N - PINNED;
  const oneAway = [...standings.stats.values()].filter(u => u.machinesPlayed === 1).slice(0, 3).map(u => ({ ...u, isOneAway: true }));
  const allTopRows = [...standings.ranked, ...oneAway];
  const restCount = Math.max(0, allTopRows.length - PINNED);
  const pages = Math.max(1, Math.ceil(restCount / PAGE));
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (pages < 2) { setPage(0); return; }
    const iv = setInterval(() => setPage(p => (p + 1) % pages), 6000);
    return () => clearInterval(iv);
  }, [pages]);
  const pg = page % pages;
  const boardRows = [...allTopRows.slice(0, PINNED), ...allTopRows.slice(PINNED + pg * PAGE, PINNED + (pg + 1) * PAGE)];
  const pgFrom = PINNED + pg * PAGE + 1, pgTo = Math.min(allTopRows.length, PINNED + (pg + 1) * PAGE);
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

  // Sound effects for each new live event (attract spotlights stay silent).
  const toast = live.toast;
  useEffect(() => {
    if (!tk || tk.kind === 'spotlight') return;
    lastEvent.current = Date.now();
    // Clock moments: no sound here; the audio module listens for the pw:clock event instead.
    if (tk.kind === 'clock') { emitClock({ what: tk.minutes ? 'mark' : tk.side, side: tk.side, minutes: tk.minutes }); return; }
    ({ leader: sfx.leader, ranked: sfx.climb, milestone: sfx.milestone }[tk.kind] || sfx.record)();
  }, [tk?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast || tk) return;
    lastEvent.current = Date.now();
    ({ join: sfx.join, climb: sfx.climb, enter: sfx.climb, pb: sfx.climb, close: sfx.climb, shame: sfx.shame, milestone: sfx.milestone }[toast.kind] || sfx.climb)();
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

  // The reveal: one prize at a time, advanced by hand (host page Next / Back, or a click, Space or the
  // arrow keys here). /tv?reveal previews it locally without touching the party.
  if (party?.reveal_active || revealPreview) {
    // Clicks / keys here move the party's reveal only on a Mac with the host page unlocked.
    const onStep = !revealPreview && getHostPass() ? n => { host.revealStep(n).catch(() => {}); } : null;
    return (
      <div className={`tv-frame tv2-frame${cursor ? ' show-cursor' : ''}`}>
        <Reveal standings={standings} awards={awards} onSlide={lights.onRevealSlide}
          step={revealPreview ? 0 : party?.reveal_step || 0} onStep={onStep} preview={revealPreview} />
      </div>
    );
  }

  const joinURL = partyUrl('/'); // carries the party key once a host unlocked this browser
  const champ = awards.champion;
  const overlays = (
    <>
      {tk && <Takeover key={tk.id} item={tk} queued={live.queued} onDone={live.nextTakeover} />}
      <FinalLayer party={party} preview={clockParam === 'final'} onTick={n => { lights.onClock?.('tick', n); emitClock({ what: 'tick', side: 'end', n }); }} />
      <button type="button" className={`tv-sound${soundOn ? ' on' : ''}`} onClick={e => { e.stopPropagation(); toggleSound(); }}>
        {soundOn ? '⚙ Sound effects: on (click to mute)' : '⚙ Sound effects: off (click to turn on)'}
      </button>
      <button type="button" className={`tv-sound tv-lights${lights.driver ? ' on' : ''}`} onClick={e => { e.stopPropagation(); lights.setDriver(!lights.driver); }}
        title="Only the TV in the garage should drive the lights">
        {lights.driver && !lights.hasTopic
          ? '⚙ Lights: unlock /host on this computer once, then reload'
          : lights.driver
          ? `⚙ Lights: this screen drives them${lights.enabled ? (lights.dry ? ' (simulator only)' : '') : ' (lights off in host)'} · click to stop`
          : '⚙ Lights: click to drive the garage lights from this screen'}
      </button>
      {demo && <div className="tv-demo">DEMO</div>}
    </>
  );

  // Free play: live scores on top, a full-height high score table per machine, the news crawl below.
  if (fpBoard) {
    return (
      <div className={`tv-frame tv2-frame${cursor ? ' show-cursor' : ''}${controls && !lightsSim ? ' show-controls' : ''}`} onClick={() => { if (!sound.isOn()) toggleSound(); }}>
        <div className="tv tv2">
          <div className="tv2-drift tv2-fp">
            <header className="tv2-head">
              <div className="tv2-brand">
                <span className="tv2-logo">WOODSIDE <b>PINBALL</b></span>
                <span className="fp-sub">
                  <span className="fp-badge">FREE PLAY</span>
                  {phase === 'pre'
                    ? <ClockChip party={party} preview={chipPreview} />
                    : <span className="fp-note">Just for fun · <i className="fp-key" /> = free play</span>}
                </span>
              </div>
              <Ticker scores={scores} players={players} machines={machines} n={8} />
            </header>

            <section className={`tv2-cabs fp-cabs${attract ? ' attract' : ''}`}>
              {highScores.map((entry, i) => (
                <Cabinet key={entry.machine.id} entry={entry} i={i} rows={FP_ROWS} hot={!!hot[entry.machine.id]} hit={live.hits[entry.machine.id]} />
              ))}
            </section>

            <Crawl standings={night} awards={awards} news={live.news} machines={machines} freePlay={phase} highScores={highScores}
              startsAt={party?.tourney_starts_at ? fmtClock(party.tourney_starts_at) : null} />

            {live.toast && <Toast key={live.toast.id} item={live.toast} onDone={live.nextToast} paused={!!tk} />}
          </div>
          {overlays}
        </div>
      </div>
    );
  }

  return (
    <div className={`tv-frame tv2-frame${cursor ? ' show-cursor' : ''}${controls && !lightsSim ? ' show-controls' : ''}`} onClick={() => { if (!sound.isOn()) toggleSound(); }}>
      <div className="tv tv2">
        <div className="tv2-drift">
          {phase === 'grace'
            ? <div className="tv2-closed grace">Play over · log your last scores now</div>
            : phase === 'over'
            ? <div className={`tv2-closed${revealedAfterEnd(party) ? '' : ' sealed'}`}>{revealedAfterEnd(party) ? 'Final results' : 'Results sealed · awards soon'}</div>
            : phase === 'closed' && <div className="tv2-closed">Scoring closed · final standings</div>}

          <header className="tv2-head">
            <div className="tv2-brand">
              <span className="tv2-logo">WOODSIDE <b>PINBALL</b></span>
              {/* Brand on top (same for every event); the current event's own name underneath, or the countdown. */}
              {(phase === 'on' || phase === 'grace') && (party?.tourney_ends_at || chipPreview)
                ? <ClockChip party={party} preview={chipPreview} />
                : <span className="tv2-stats tv2-event">{event?.name || `${standings.meta.totalPlayers} players · ${standings.meta.totalScores} games`}</span>}
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
                {boardRows.map((st, i) => {
                  const hide = isSealed && !st.isOneAway && st.rank <= 3; // the podium is a secret until the awards
                  return (
                  <div key={i < PINNED ? st.player.id : `${pg}-${st.player.id}`} className={`pr${!st.isOneAway && st.rank <= 3 ? ` p${st.rank}` : ''}${st.isOneAway ? ' one-away' : ''}${i >= PINNED && pages > 1 ? ' paged' : ''}${flash[st.player.id] && !hide ? ' flash' : ''}${hide ? ' sealed' : ''}`}>
                    <span className="pr-rank">{st.isOneAway ? '·' : st.rank}</span>
                    {hide ? <span /> : <Avatar avatar={st.player.avatar} emoji={st.player.emoji} name={st.player.display_name} color={st.player.color} size={24} />}
                    <span className="pr-name">{hide ? '? ? ?' : st.player.display_name}{!hide && st.player.first_timer && <span className="pr-ft">NEW</span>}</span>
                    <span className="pr-crowns">{!hide && st.crowns > 0 && <><Icon name="crown" size={15} stroke={2.2} />{st.crowns > 1 ? <span>×{st.crowns}</span> : null}</>}</span>
                    <span className="pr-tables">{hide ? '' : `${st.machinesPlayed}/${machines.length}`}</span>
                    {st.isOneAway
                      ? <span className="pr-nudge">1 MORE</span>
                      : hide ? <Dmd className="pr-val">??</Dmd>
                      : <Dmd className="pr-val" tone={st.rank === 1 ? 'hot' : undefined}><CountUp value={st.rating} /></Dmd>}
                  </div>
                  );
                })}
                {boardRows.length === 0 && <div className="pnl-empty">Play 2 machines to rank</div>}
              </div>
              <div className="pnl-legend">Avg finish · 2+ machines to rank</div>
            </div>

            <div className="pnl pnl-shame">
              <PanelHead icon="skull" title="Wall of Shame" sub="lowest" />
              <div className="pb">
                {standings.bottomPlayers.length ? standings.bottomPlayers.map((st, i) => (
                  // Sealed: the bottom of the board would give away The Big Whiff.
                  <div key={st.player.id} className={`pr shame${isSealed ? ' sealed' : ''}`}>
                    <span className="pr-rank">{i + 1}</span>
                    {isSealed ? <span /> : <Avatar avatar={st.player.avatar} emoji={st.player.emoji} name={st.player.display_name} color={st.player.color} size={24} />}
                    <span className="pr-name">{isSealed ? '? ? ?' : st.player.display_name}</span>
                    <span className="pr-worst">{!isSealed && st.worst ? `${st.worst.rank}/${st.worst.N}` : ''}</span>
                    <Dmd className="pr-val" tone="red">{isSealed ? '??' : st.rating}</Dmd>
                  </div>
                )) : <div className="pnl-empty">Nobody… yet</div>}
              </div>
              <div className="pnl-legend">Ranked with love. 💀</div>
            </div>

            <PrizePanel awards={awards} sealed={isSealed} />

            <section className="pnl pnl-qr">
              <div className="qr-label">SCAN TO PLAY</div>
              <div className="qr-box"><QR value={joinURL} size={150} light="#e9e9e9" /></div>
              <div className="qr-url">{location.host}</div>
            </section>
          </div>

          <Crawl standings={standings} awards={awards} news={live.news} machines={machines} sealed={isSealed} />

          {live.toast && <Toast key={live.toast.id} item={live.toast} onDone={live.nextToast} paused={!!tk} />}
        </div>

        {overlays}
      </div>
    </div>
  );
}

// Tournament clock hook for sound (web/src/lib/audio): window 'pw:clock' events, detail =
//   { what: 'mark', side: 'start' | 'end', minutes }  a minute-mark card (start 5…1, end 15/10/5…1)
//   { what: 'start', side: 'start', minutes: 0 }      TOURNAMENT IS ON card
//   { what: 'end', side: 'end', minutes: 0 }          END OF TOURNAMENT / GAME OVER card
//   { what: 'tick', side: 'end', n }                  each of the final 10 seconds (n = 10…1)
const emitClock = detail => { try { window.dispatchEvent(new CustomEvent('pw:clock', { detail })); } catch { /* ignore */ } };

const FP_ROWS = 19; // rows per machine on the free-play board

// Tournament clock takeovers: 5…1 minutes before the start, 15/10/5…1 before the end, then the start
// and end cards. Each fires once (remembered in this browser) and only near its time, so a TV that
// slept or reloaded doesn't replay old ones.
const FIRED_KEY = 'pw.clockFired';
const readFired = () => { try { return new Set(JSON.parse(localStorage.getItem(FIRED_KEY) || '[]')); } catch { return new Set(); } };
const saveFired = set => { try { localStorage.setItem(FIRED_KEY, JSON.stringify([...set].slice(-60))); } catch { /* ignore */ } };
function useClockMoments({ party, ready, push }) {
  const partyRef = useRef(party);
  partyRef.current = party;
  useEffect(() => {
    if (!ready) return undefined;
    const iv = setInterval(() => {
      const fired = readFired();
      const m = dueClockMoment(partyRef.current, serverNow(), fired);
      if (!m) return;
      fired.add(m.key);
      saveFired(fired);
      push({ kind: 'clock', id: m.key, side: m.kind, minutes: m.minutes, target: m.target });
    }, 1000);
    return () => clearInterval(iv);
  }, [ready, push]);
}

// The last 10 seconds before the end, over everything (the lights pulse each second).
function FinalLayer({ party, preview, onTick }) {
  const now = useNow(200);
  const n = preview ? 7 : finalSeconds(party, now);
  useEffect(() => { if (n > 0 && !preview) onTick?.(n); }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  return n > 0 ? <FinalCountdown n={n} /> : null;
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
function PrizePanel({ awards, sealed: isSealed = false }) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPage(p => 1 - p), PRIZE_PAGE_MS);
    return () => clearInterval(t);
  }, []);
  const st = (x, f) => (x ? f(x) : '');
  if (isSealed) {
    return (
      <section className="pnl pnl-prizes">
        <PanelHead icon="medal" title="Prizes" sub="sealed" />
        <div className="pz-sealed"><span>RESULTS SEALED</span><small>12 prizes · revealed at the awards</small></div>
      </section>
    );
  }
  return (
    <section className="pnl pnl-prizes">
      <PanelHead icon="medal" title="Prizes" sub={page === 0 ? 'overall 1/2' : 'machines 2/2'} />
      <div className="pz-list" key={page}>
        {page === 0 ? <>
          <Prize icon="trophy" name="Grand Champion" crit="best rating" who={awards.champion?.player} stat={st(awards.champion, c => `${c.rating}/100`)} gold />
          <Prize icon="medal" name="2nd Place" crit="2nd-best rating" who={awards.second?.player} stat={st(awards.second, c => `${c.rating}/100`)} />
          <Prize icon="medal" name="3rd Place" crit="3rd-best rating" who={awards.third?.player} stat={st(awards.third, c => `${c.rating}/100`)} />
          <Prize icon="grind" name="The Grinder" crit="most games" who={awards.grinder?.player} stat={st(awards.grinder, g => `${g.plays} games`)} />
          <Prize icon="burst" name="The Big Whiff" crit="lowest rating, no other prize" who={awards.bigWhiff?.player} stat={st(awards.bigWhiff, w => `${w.rating}/100`)} dim />
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
