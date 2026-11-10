import { useEffect, useState } from 'react';
import Avatar from './Avatar.jsx';
import Confetti from './Confetti.jsx';
import Icon from './Icon.jsx';
import Backbox from './tv/Backbox.jsx';
import Dmd from './tv/Dmd.jsx';
import { artFallback, machineArt, machineGlow } from './tv/theme.js';
import { useRamp } from './tv/Takeover.jsx';
import '../tv.css';

const fmt = n => Number(n).toLocaleString();
const COUNT_MS = 1000; // each number of the 3-2-1
const ordinal = n => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

// The reveal, one prize at a time, in the order prizes are decided: Grand Champion, 2nd, 3rd, the
// machine champions, The Grinder, The Big Whiff, The Match. Each prize: its standings walked from the
// top to the highest person without a prize (The Match: a draw and a slot-machine spin), then the winner, then it waits for the
// host (`step` from the party, via the host page's Next / Back) or a click / Space / arrow key here.
export default function Reveal({ standings, awards, onSlide, step = 0, onStep, preview = false }) {
  const slides = buildSlides({ standings, awards });
  const last = Math.max(0, slides.length - 1);
  const [idx, setIdx] = useState(Math.min(step, last));
  useEffect(() => { setIdx(Math.min(step, last)); }, [step, last]);
  // Only a screen that can move the whole party's reveal (host unlocked) or a local preview advances,
  // so the TV and the host page never disagree about which prize is up.
  const canAdvance = preview || !!onStep;
  const go = n => {
    if (!canAdvance) return;
    const next = Math.max(0, Math.min(last, n));
    if (next === idx) return;
    setIdx(next);
    onStep?.(next);
  };
  useEffect(() => {
    const key = e => {
      if (e.repeat) return; // holding a key must not skip prizes
      if (['ArrowRight', ' ', 'Enter', 'PageDown'].includes(e.key)) { e.preventDefault(); go(idx + 1); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(idx - 1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // 3, 2, 1, then the winner (count 0). The lights get each count and the reveal, on the same timeline.
  const cur = slides[idx] ?? slides[0];
  const cueKey = cur ? `${idx}:${cur.label}:${cur.title || ''}` : '';
  // The count belongs to one prize: a new prize starts at 3 on its very first frame (no flash of the
  // winner before the countdown).
  const [cd, setCd] = useState({ k: cueKey, n: 3 });
  const count = cd.k === cueKey ? cd.n : 3;
  useEffect(() => {
    if (!cur) return undefined;
    // The Match swaps the 3-2-1 for its draw and slot-machine spin; the lights still get 3, 2, 1.
    const t = cur.spin ? spinTimes(cur.spin) : cur.walk?.rows.length ? walkTimes(cur.walk)
      : { at: [0, COUNT_MS, COUNT_MS * 2], show: COUNT_MS * 3 };
    const ts = [setTimeout(() => onSlide?.(cur, 'count', 3), 0)]; // after the lights engine is up
    [2, 1].forEach((n, k) => ts.push(setTimeout(() => { setCd({ k: cueKey, n }); onSlide?.(cur, 'count', n); }, t.at[k + 1])));
    ts.push(setTimeout(() => { setCd({ k: cueKey, n: 0 }); onSlide?.(cur, 'show'); }, t.show));
    return () => ts.forEach(clearTimeout);
  }, [cueKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const slide = slides[idx] ?? slides[0];
  if (!slide) return <div className="reveal-tv rv"><div className="rv-empty">No data to reveal yet.</div></div>;

  const accent = slide.accent || '#ffcc33';
  const split = !!slide.machine;

  if (count > 0 && slide.spin) {
    return (
      <div className="reveal-tv rv rv-counting" style={{ '--accent': accent }} onClick={() => go(idx + 1)}>
        <div className="rv-shade" />
        <div className="rv-top" key={`top${idx}`}><div className="rv-pill">{slide.label}</div></div>
        <MatchSpin key={cueKey} spin={slide.spin} />
        <Dots slides={slides} idx={idx} />
      </div>
    );
  }

  if (count > 0 && slide.walk?.rows.length) {
    return (
      <div className="reveal-tv rv rv-counting" style={{ '--accent': accent }} onClick={() => go(idx + 1)}>
        {slide.machine && <img key={`bg${idx}`} className="rv-bg" src={machineArt(slide.machine.name)} alt="" onError={e => artFallback(e, slide.machine.name)} />}
        <div className="rv-shade" />
        <div className="rv-top" key={`top${idx}`}><div className="rv-pill">{slide.label}</div></div>
        <WalkList key={cueKey} walk={slide.walk} />
        <Dots slides={slides} idx={idx} />
      </div>
    );
  }

  if (count > 0) {
    return (
      <div className="reveal-tv rv rv-counting" style={{ '--accent': accent, '--slide-ms': `${COUNT_MS * 3}ms` }} onClick={() => go(idx + 1)}>
        {slide.machine && <img key={`bg${idx}`} className="rv-bg" src={machineArt(slide.machine.name)} alt="" onError={e => artFallback(e, slide.machine.name)} />}
        <div className="rv-shade" />
        <div className="rv-top" key={`top${idx}`}><div className="rv-pill">{slide.label}</div></div>
        <div className="rv-countdown">
          <div className="rv-count-lead">And the winner is…</div>
          <div className="rv-count-num" key={`n${idx}-${count}`}>{count}</div>
        </div>
        <Dots slides={slides} idx={idx} />
      </div>
    );
  }

  return (
    <div className="reveal-tv rv" style={{ '--accent': accent, '--slide-ms': '1ms' }} onClick={() => go(idx + 1)}>
      {slide.machine && <img key={`bg${idx}`} className="rv-bg" src={machineArt(slide.machine.name)} alt="" onError={e => artFallback(e, slide.machine.name)} />}
      {slide.machine && <div className="rv-shade" />}
      <div className="rv-glow" />
      {slide.rays && <div className="rv-rays" />}
      {slide.confetti && <Confetti key={`c${idx}`} count={130} seed={idx} />}

      <div className="rv-top" key={`top${idx}`}><div className="rv-pill">{slide.label}</div></div>

      <div className={`rv-stage${split ? ' split' : ''}${slide.trophy ? ' tall' : ''}`} key={`s${idx}`}>
        {split && <Backbox machine={slide.machine} className="rv-split-bb" />}
        <div className={split ? 'rv-split-info' : 'rv-center'} style={split ? null : { display: 'contents' }}>
          {slide.trophy && <div className="rv-trophy"><Icon name="trophy" size={110} stroke={1.6} /></div>}
          {slide.hero && (
            <div className="rv-hero">
              <Avatar avatar={slide.hero.avatar} emoji={slide.hero.emoji} name={slide.hero.name} color={slide.hero.color} size={split ? 150 : slide.trophy ? 140 : 170} />
            </div>
          )}
          {slide.list ? (
            <ul className="rv-list">{slide.list.map((item, k) => (
              <li key={k}>
                <Avatar avatar={item.player.avatar} emoji={item.player.emoji} name={item.player.display_name} color={item.player.color} size={52} />
                {item.player.display_name}{item.note && <small>{item.note}</small>}
              </li>
            ))}</ul>
          ) : (
            <div className="rv-title">{slide.title}</div>
          )}
          {slide.subtitle && <div className="rv-sub">{slide.subtitle}</div>}
          {slide.score != null && slide.score !== '' && (
            <Dmd ghost tone="hot" className="rv-score" reserve={slide.scoreCount ? fmt(slide.score) : undefined}>
              {slide.scoreCount ? <Ramp value={slide.score} /> : slide.score}
            </Dmd>
          )}
          {slide.footer && <div className="rv-footer">{slide.footer}</div>}
        </div>
      </div>

      <Dots slides={slides} idx={idx} />
    </div>
  );
}

// The Match on the TV: the number rolls like a pinball Match (00 … 90) and lands on the draw, then a
// slot-machine reel spins through the players in the tie-break (or everyone still in the running, when
// only one matched), slows down and stops on the winner.
const DRAW_MS = 2600, REEL_MS = 6200, SHORT_REEL_MS = 1800, HOLD_MS = 1300;
function spinTimes(spin) {
  const reel = spin.items.length > 1 ? REEL_MS : SHORT_REEL_MS;
  return { at: [0, DRAW_MS, DRAW_MS + reel * 0.55], show: DRAW_MS + reel + HOLD_MS, reel };
}
const ease = x => 1 - Math.pow(1 - x, 4);
const ITEM_H = 120;

function MatchSpin({ spin }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const iv = setInterval(() => setT(performance.now() - t0), 30);
    return () => clearInterval(iv);
  }, []);
  const { reel } = spinTimes(spin);
  const draw2 = String(spin.drawn).padStart(2, '0');
  // Number roll: ticks through 00 … 90, slowing, and lands on the draw.
  let shown = draw2;
  if (t < DRAW_MS) {
    const ticks = Math.floor(ease(t / DRAW_MS) * 24);
    shown = String(((spin.drawn / 10 + ticks - 24) % 10 + 10) % 10 * 10).padStart(2, '0');
  }
  const landed = t >= DRAW_MS;
  // The reel: the items repeated, ending on the winner (items[0]).
  const n = spin.items.length;
  const base = [...spin.items.slice(1), spin.items[0]];
  const reps = n > 1 ? Math.max(2, Math.ceil(26 / n)) : 1;
  const strip = Array.from({ length: reps }, () => base).flat();
  const L = strip.length;
  const x = landed ? Math.min(1, (t - DRAW_MS) / reel) : 0;
  const pos = (L - 1) * ease(x);
  const stopped = x >= 1;
  return (
    <div className="rv-spin">
      <div className="rv-spin-draw">
        <div className="rv-count-lead">The Match number is…</div>
        <Dmd ghost tone="hot" className={`rv-spin-num${landed ? ' on' : ''}`} reserve="00">{shown}</Dmd>
      </div>
      <div className={`rv-spin-note${landed ? ' on' : ''}`}>{spin.note}</div>
      <div className={`rv-reel${landed ? ' on' : ''}${stopped ? ' stopped' : ''}`}>
        <div className="rv-reel-strip" style={{ transform: `translateY(${(1 - pos) * ITEM_H}px)` }}>
          {strip.map((p, k) => (
            <div key={k} className={`rv-reel-item${stopped && k === L - 1 ? ' win' : ''}`} style={{ opacity: Math.max(0.15, 1 - Math.abs(k - pos) * 0.55) }}>
              <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={84} />
              <span>{p.display_name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// The walk down a prize's standings: a cursor starts at the top, marks each person who already won a
// prize ("WON: 2ND PLACE") and moves on, and stops on the winner (or runs off the end: nobody left).
const WALK_IN = 1100, WALK_HOLD = 1400, ROW_H = 92, ROWS_SHOWN = 6;
function walkTimes(w) {
  const steps = w.win >= 0 ? w.win : w.rows.length; // -1: walk past everyone
  const step = steps ? Math.max(380, Math.min(800, 4200 / steps)) : 0;
  const land = WALK_IN + steps * step;
  const show = Math.max(3200, land + WALK_HOLD);
  return { at: [0, show / 3, (show * 2) / 3], show, step, land };
}

function WalkList({ walk }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const iv = setInterval(() => setT(performance.now() - t0), 50);
    return () => clearInterval(iv);
  }, []);
  const { step, land } = walkTimes(walk);
  const end = walk.win >= 0 ? walk.win : walk.rows.length;
  const cur = t < WALK_IN ? 0 : Math.min(end, step ? Math.floor((t - WALK_IN) / step) : 0);
  const landed = t >= land;
  const top = Math.max(0, Math.min(cur - 2, walk.rows.length - ROWS_SHOWN));
  return (
    <div className="rv-walk">
      <div className="rv-count-lead">{walk.lead}</div>
      <div className="rv-walk-box" style={{ height: ROW_H * Math.min(ROWS_SHOWN, walk.rows.length) }}>
        <ol className="rv-walk-list" style={{ transform: `translateY(${-top * ROW_H}px)` }}>
          {walk.rows.map((r, k) => {
            const passed = k < cur || (k === cur && landed && walk.win < 0);
            const here = k === cur && !(landed && walk.win < 0);
            const cls = `rv-walk-row${here ? ' here' : ''}${here && landed ? ' win' : ''}${passed && r.won ? ' taken' : ''}`;
            return (
              <li key={k} className={cls}>
                <span className="rv-walk-rank">{k + 1}</span>
                <Avatar avatar={r.player.avatar} emoji={r.player.emoji} name={r.player.display_name} color={r.player.color} size={60} />
                <span className="rv-walk-name">{r.player.display_name}</span>
                {passed && r.won ? <span className="rv-walk-won">WON {r.won}</span> : <span className="rv-walk-val">{r.value}</span>}
              </li>
            );
          })}
        </ol>
      </div>
      <div className={`rv-walk-note${landed ? ' on' : ''}`}>{walk.win >= 0 ? 'Highest without a prize…' : 'Everyone here already has a prize!'}</div>
    </div>
  );
}

function Dots({ slides, idx }) {
  return (
    <div className="rv-dots">
      {slides.map((_, i) => <span key={i === idx ? `on${idx}` : i} className={`rv-dot${i === idx ? ' on' : i < idx ? ' done' : ''}`} />)}
    </div>
  );
}

// For the host page: what each step of the reveal shows.
export function revealPlan({ standings, awards }) {
  return buildSlides({ standings, awards }).map(s => ({
    label: s.label, title: s.title,
    walk: s.walk && { stopsOn: s.walk.rows[s.walk.win]?.player.display_name ?? null, above: s.walk.rows.slice(0, s.walk.win < 0 ? undefined : s.walk.win).map(r => r.won) },
  }));
}

function Ramp({ value }) {
  return fmt(useRamp(0, Number(value) || 0, 1600, 450));
}

const hero = p => p && { avatar: p.avatar, emoji: p.emoji, name: p.display_name, color: p.color };

// All 12 prizes in the order they're decided (one prize each, best prize first): Grand Champion, 2nd,
// 3rd, the six machine champions, The Grinder, The Big Whiff, The Match. Before each winner, the TV
// shows that prize's standings and walks down from the top: anyone who already won a prize is marked
// and skipped, and it stops on the highest person still without one. A prize nobody can win still gets
// its slide (the walk runs off the end), so the reveal never skips one.
const noWinner = (label, accent, why, extra = {}) => ({
  label, empty: true, title: 'No winner tonight', subtitle: why, accent, confetti: false, ...extra,
});

function matchSpin(t) {
  const d = String(t.drawn).padStart(2, '0');
  const tied = t.tied?.length ? t.tied : [t.player];
  const items = tied.length > 1 ? tied : [t.player, ...(t.pool ?? [])].slice(0, 14);
  const k = tied.length;
  const note = t.exact
    ? (k > 1 ? `${k} players' totals end in ${d}: spin for it!` : `Only one total ends in ${d}!`)
    : (k > 1 ? `Nobody's total ends in ${d}, so everyone left is in the spin!` : `Nobody's total ends in ${d}, and only one player is left…`);
  return { drawn: t.drawn, items, note };
}

function buildSlides({ standings, awards }) {
  const slides = [];
  const NOBODY = 'everyone eligible already won a prize';
  const stats = [...(standings?.stats?.values?.() ?? [])];
  const playerOf = id => standings?.stats?.get(id)?.player;
  const won = new Map(); // playerId -> the prize they won on an earlier slide
  // A walk: the standings rows for this prize, and where it stops (-1: nobody left).
  const walk = (lead, rows, winner) => {
    const list = rows.filter(r => r.player);
    const win = winner ? list.findIndex(r => r.player.id === winner.id) : -1;
    return { lead, rows: list.map(r => ({ ...r, won: won.get(r.player.id) || null })), win };
  };
  const push = (slide, winner) => { slides.push(slide); if (winner) won.set(winner.id, slide.label); };

  // The podium.
  const ranked = standings?.ranked ?? [];
  const byRating = ranked.map(st => ({ player: st.player, value: `${st.rating}/100` }));
  const podium = [
    [awards?.champion, 'GRAND CHAMPION', '#ffcc33', '🎉 Woodside Pinball 2026 🎉', 'nobody has played 2+ machines yet'],
    [awards?.second, '2ND PLACE', '#c0c7d4', '🥈', 'not enough ranked players (2+ machines each)'],
    [awards?.third, '3RD PLACE', '#cd7f32', '🥉', 'not enough ranked players (2+ machines each)'],
  ];
  for (const [st, label, accent, footer, why] of podium) {
    const w = walk('Overall rating', byRating, st?.player);
    if (!st) { push(noWinner(label, accent, why, { walk: w })); continue; }
    const grand = label === 'GRAND CHAMPION';
    push({
      label, confetti: true, hero: hero(st.player), title: st.player.display_name, accent, footer, walk: w,
      trophy: grand, rays: grand,
      subtitle: grand ? `The Pinball Wizard · ${st.crowns} crown${st.crowns === 1 ? '' : 's'}` : `${st.machinesPlayed} machines played`,
      score: `${st.rating}/100`,
    }, st.player);
  }

  // A champion for each machine (in the machines' order on the board).
  const champs = awards?.machineChamps?.length ? awards.machineChamps : (standings?.machines ?? []).map(m => ({ machine: m.machine, player: null }));
  for (const c of champs) {
    const m = c.machine;
    const rows = (standings?.machines?.find(x => x.machine.id === m.id)?.rows ?? []).map(r => ({ player: playerOf(r.playerId), value: fmt(r.best) }));
    const w = walk(`Best score on ${m.name}`, rows, c.player);
    if (!c.player) {
      push(noWinner(`${m.name.toUpperCase()} CHAMPION`, machineGlow(m.name), c.noScores ? 'nobody played it' : NOBODY, { machine: m, walk: w }));
      continue;
    }
    push({
      label: `${m.name.toUpperCase()} CHAMPION`, confetti: true, hero: hero(c.player), machine: m,
      title: c.player.display_name, subtitle: `${m.manufacturer} · ${m.year}`,
      score: c.score, scoreCount: true, accent: machineGlow(m.name), walk: w,
      footer: c.rank > 1 ? 'top score still without a prize 👑' : '👑',
    }, c.player);
  }

  // The Grinder: most games logged.
  const g = awards?.grinder;
  const byPlays = stats.filter(st => st.plays > 0).sort((a, b) => b.plays - a.plays || a.player.id - b.player.id)
    .map(st => ({ player: st.player, value: `${st.plays} games` }));
  const gw = walk('Most games logged', byPlays, g?.player);
  push(g
    ? {
      label: 'THE GRINDER', confetti: true, hero: hero(g.player), title: g.player.display_name, walk: gw,
      subtitle: `${g.plays} games logged`, accent: '#4d8bff', footer: 'absolutely sent it 💪',
    }
    : noWinner('THE GRINDER', '#4d8bff', NOBODY, { walk: gw }), g?.player);

  // The Big Whiff: lowest rating.
  const wh = awards?.bigWhiff;
  const byLow = [...ranked].sort((a, b) => a.rating - b.rating || b.machinesPlayed - a.machinesPlayed)
    .map(st => ({ player: st.player, value: `${st.rating}/100` }));
  const ww = walk('Lowest overall rating', byLow, wh?.player);
  push(wh
    ? {
      label: 'THE BIG WHIFF', confetti: false, hero: hero(wh.player), title: wh.player.display_name, walk: ww,
      subtitle: wh.worst
        ? `Lowlight: ${ordinal(wh.worst.rank)} of ${wh.worst.N} on ${wh.worst.machineName}`
        : `${wh.machinesPlayed} machines played`,
      score: `${wh.rating}/100`, accent: '#ff5b5b', footer: 'a humble effort, bravely made 🤝',
    }
    : noWinner('THE BIG WHIFF', '#ff5b5b', NOBODY, { walk: ww }), wh?.player);

  // The Match, last: the draw and a slot-machine spin through everyone who matched.
  const t = awards?.theMatch;
  push(t
    ? {
      label: 'THE MATCH', confetti: true, hero: hero(t.player), title: t.player.display_name,
      subtitle: `Match ${String(t.drawn).padStart(2, '0')} · total points from ${t.games} game${t.games === 1 ? '' : 's'}`,
      score: t.value, scoreCount: true, accent: '#29d4d4',
      footer: t.tied?.length > 1 ? `won the spin against ${t.tied.length - 1} other match${t.tied.length > 2 ? 'es' : ''} 🎰` : 'pure luck, the best kind 🎰',
      spin: matchSpin(t),
    }
    : noWinner('THE MATCH', '#29d4d4', awards?.matchDrawn ? NOBODY : 'no number was drawn tonight'), t?.player);
  return slides;
}
