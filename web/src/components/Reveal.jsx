import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Confetti from './Confetti.jsx';
import Icon from './Icon.jsx';
import Backbox from './tv/Backbox.jsx';
import Dmd from './tv/Dmd.jsx';
import { artFallback, machineArt, machineGlow } from './tv/theme.js';
import { useRamp } from './tv/Takeover.jsx';
import { PODIUM_MIN, podiumOk, tieBreakNote } from '../lib/scoring.js';
import '../tv.css';

const fmt = n => Number(n).toLocaleString();
const COUNT_MS = 1000; // each number of the 3-2-1
const ordinal = n => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

// The reveal, one slide at a time (`step`, from party.reveal_step): 0 = the intro ("AWARDS CEREMONY",
// held until Next), 1–12 = the prizes in the order they're decided (Grand Champion, 2nd, 3rd, the machine
// champions, The Grinder, The Big Whiff, The Match), 13 = the finale (every winner, group photo, free
// play). Each prize: its build-up (3-2-1 and/or a walk down its standings; The Match: a draw and a
// slot-machine spin), then the winner, then it waits for the host's Next / Back.
// Going Back shows that slide's winner at once (no replayed build-up); going forward plays it in full.
// Keys on the TV (safety, Nov 10): in the live reveal only Shift + → / Space / Enter / PageDown (next) or
// Shift + ← / PageUp / Backspace (back) move it, and clicks do nothing, so a cat on the keyboard or a
// guest bumping the mouse can't skip a prize. The local preview (/tv?reveal) takes plain keys and clicks.
// Sound hook: every phase change dispatches window event `pw:reveal` (see emitReveal); no sounds here.
export default function Reveal({ standings, awards, onSlide, step = 0, onStep, onShown, preview = false }) {
  const slides = buildSlides({ standings, awards });
  const last = Math.max(0, slides.length - 1);
  const [idx, setIdx] = useState(Math.min(step, last));
  useEffect(() => { setIdx(Math.min(step, last)); }, [step, last]);
  useEffect(() => { onShown?.(idx); }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const click = preview ? () => go(idx + 1) : undefined;
  useEffect(() => {
    const key = e => {
      if (e.repeat) return; // holding a key must not skip prizes
      if (!preview && !e.shiftKey) return; // live: Shift + key only
      if (['ArrowRight', ' ', 'Enter', 'PageDown'].includes(e.key)) { e.preventDefault(); go(idx + 1); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(idx - 1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // Each prize's build-up, then the winner. Grand Champion: 3-2-1. 2nd and 3rd: a walk down the
  // ratings. The other prizes: 3-2-1, then a walk down that prize's standings. The Match: its draw and
  // spin. The lights get 3, 2, 1 and the reveal on the same timeline.
  const cur = slides[idx] ?? slides[0];
  const cueKey = cur ? `${idx}:${cur.label}:${cur.title || ''}` : '';
  // Back: this slide shows its winner straight away. Forward (or a fresh load): the full build-up.
  const prevIdx = useRef(idx);
  const instantKeys = useRef(new Set());
  if (prevIdx.current !== idx) {
    if (idx < prevIdx.current) instantKeys.current.add(cueKey); else instantKeys.current.delete(cueKey);
    prevIdx.current = idx;
  }
  const instant = instantKeys.current.has(cueKey);
  const mode = instant ? 'hold' : modeOf(cur);
  const first = mode === 'walk' ? 'walk' : mode === 'spin' ? 'spin' : mode === 'hold' ? 0 : 3;
  // The phase belongs to one prize: a new prize starts at its first phase on its very first frame (no
  // flash of the winner before the build-up).
  const [cd, setCd] = useState({ k: cueKey, n: first });
  const phase = cd.k === cueKey && !instant ? cd.n : first;
  useEffect(() => {
    if (!cur) return undefined;
    const set = n => setCd({ k: cueKey, n });
    const base = { step: idx, label: cur.label, preview };
    if (mode === 'hold') {
      // The intro and the finale wait for Next; Back lands on the winner directly.
      const t = setTimeout(() => {
        onSlide?.(cur, 'show');
        emitReveal({ ...base, what: cur.intro ? 'intro' : cur.finale ? 'finale' : 'show', back: instant });
      }, 0);
      return () => clearTimeout(t);
    }
    const ts = [setTimeout(() => { onSlide?.(cur, 'count', 3); emitReveal({ ...base, what: mode === 'spin' ? 'spin' : mode === 'walk' ? 'walk' : 'count', n: 3 }); }, 0)]; // after the lights engine is up
    const at = (ms, f) => ts.push(setTimeout(f, ms));
    let show;
    if (mode === 'spin' || mode === 'walk') {
      const t = mode === 'spin' ? spinTimes(cur.spin) : walkTimes(cur.walk);
      at(t.at[1], () => onSlide?.(cur, 'count', 2));
      at(t.at[2], () => onSlide?.(cur, 'count', 1));
      show = t.show;
    } else {
      at(COUNT_MS, () => { set(2); onSlide?.(cur, 'count', 2); emitReveal({ ...base, what: 'count', n: 2 }); });
      at(COUNT_MS * 2, () => { set(1); onSlide?.(cur, 'count', 1); emitReveal({ ...base, what: 'count', n: 1 }); });
      show = COUNT_MS * 3;
      if (mode === 'countwalk') {
        at(show, () => { set('walk'); emitReveal({ ...base, what: 'walk' }); });
        show += Math.max(1500, walkTimes(cur.walk).land + WALK_HOLD);
      }
    }
    at(show, () => { set(0); onSlide?.(cur, 'show'); emitReveal({ ...base, what: 'show', empty: !!cur.empty }); });
    return () => ts.forEach(clearTimeout);
  }, [cueKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = typeof phase === 'number' ? phase : 0;

  const slide = slides[idx] ?? slides[0];
  if (!slide) return <div className="reveal-tv rv"><div className="rv-empty">No data to reveal yet.</div></div>;

  const accent = slide.accent || '#ffcc33';
  const split = !!slide.machine;

  if (phase === 'spin') {
    return (
      <div className="reveal-tv rv rv-counting" style={{ '--accent': accent }} onClick={click}>
        <div className="rv-shade" />
        <div className="rv-top" key={`top${idx}`}><div className="rv-pill">{slide.label}</div></div>
        <MatchSpin key={cueKey} spin={slide.spin} />
        <Dots slides={slides} idx={idx} />
      </div>
    );
  }

  if (phase === 'walk') {
    return (
      <div className="reveal-tv rv rv-counting" style={{ '--accent': accent }} onClick={click}>
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
      <div className="reveal-tv rv rv-counting" style={{ '--accent': accent, '--slide-ms': `${COUNT_MS * 3}ms` }} onClick={click}>
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

  if (slide.intro) {
    return (
      <div className="reveal-tv rv rv-intro" style={{ '--accent': accent, '--slide-ms': '1ms' }} onClick={click}>
        <div className="rv-glow" />
        <div className="rv-rays" />
        <div className="rv-stage" key={`s${idx}`}>
          <div className="rv-trophy"><Icon name="trophy" size={110} stroke={1.6} /></div>
          <div className="rv-title">AWARDS CEREMONY</div>
          <div className="rv-sub">{slide.count} prizes · gather round!</div>
          <div className="rv-footer">Not here? A friend can accept for you.</div>
        </div>
        <Dots slides={slides} idx={idx} />
      </div>
    );
  }

  if (slide.finale) {
    return (
      <div className="reveal-tv rv rv-finale" style={{ '--accent': accent, '--slide-ms': '1ms' }} onClick={click}>
        <div className="rv-glow" />
        <div className="rv-rays" />
        <Confetti key={`c${idx}`} count={160} seed={idx} />
        <div className="rv-fin" key={`s${idx}`}>
          <div className="rv-fin-title">THANKS FOR PLAYING</div>
          <ul className="rv-fin-grid">
            {slide.winners.map((w, k) => (
              <li key={k} className={w.player ? '' : 'none'} style={{ '--c': w.accent }}>
                {w.player
                  ? <Avatar avatar={w.player.avatar} emoji={w.player.emoji} name={w.player.display_name} color={w.player.color} size={96} />
                  : <span className="rv-fin-empty">—</span>}
                <span className="rv-fin-name">{w.player ? w.player.display_name : 'No winner'}</span>
                <span className="rv-fin-prize">{w.prize}</span>
              </li>
            ))}
          </ul>
          <div className="rv-fin-photo">📸 Winners up front · GROUP PHOTO!</div>
          <div className="rv-fin-free">FREE PLAY IS ON · keep playing!</div>
        </div>
        <Dots slides={slides} idx={idx} />
      </div>
    );
  }

  return (
    <div className="reveal-tv rv" style={{ '--accent': accent, '--slide-ms': '1ms' }} onClick={click}>
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
          {slide.tie && <div className="rv-tie">{slide.tie}</div>}
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
function modeOf(slide) {
  if (!slide) return 'count';
  if (slide.hold) return 'hold';
  if (slide.spin) return 'spin';
  if (!slide.walk?.rows.length) return 'count';
  return slide.walkOnly ? 'walk' : 'countwalk';
}
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
            const cls = `rv-walk-row${here ? ' here' : ''}${here && landed ? ' win' : ''}${passed && r.won ? ' taken' : ''}${passed && r.won === NEEDS ? ' needs' : ''}`;
            return (
              <li key={k} className={cls}>
                <span className="rv-walk-rank">{k + 1}</span>
                <Avatar avatar={r.player.avatar} emoji={r.player.emoji} name={r.player.display_name} color={r.player.color} size={60} />
                <span className="rv-walk-name">{r.player.display_name}</span>
                {passed && r.won ? <span className="rv-walk-won">{r.won === NEEDS ? `NEEDS ${PODIUM_MIN} MACHINES` : `WON ${r.won}`}</span> : <span className="rv-walk-val">{r.value}</span>}
              </li>
            );
          })}
        </ol>
      </div>
      <div className={`rv-walk-note${landed ? ' on' : ''}`}>{walk.win >= 0 ? (walk.podium ? `Highest with ${PODIUM_MIN}+ machines and no prize…` : 'Highest without a prize…') : walk.podium ? `Nobody left with ${PODIUM_MIN}+ machines!` : 'Everyone here already has a prize!'}</div>
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

// For the host page (and tests): what each step of the reveal shows. kind: 'intro' | 'prize' | 'finale'.
// winner: the winner's name (null for no winner / the intro / the finale).
export function revealPlan({ standings, awards }) {
  return buildSlides({ standings, awards }).map(s => ({
    kind: s.intro ? 'intro' : s.finale ? 'finale' : 'prize',
    label: s.label, title: s.title,
    winner: s.intro || s.finale || s.empty ? null : s.title,
    playerId: s.winnerId ?? null,
    tie: s.tie || null,
    winners: s.winners ? s.winners.map(w => w.player?.display_name ?? null) : undefined,
    walk: s.walk && { stopsOn: s.walk.rows[s.walk.win]?.player.display_name ?? null, above: s.walk.rows.slice(0, s.walk.win < 0 ? undefined : s.walk.win).map(r => r.won) },
  }));
}
export const PRIZE_COUNT = 12;
export const FINALE_STEP = PRIZE_COUNT + 1; // 0 intro, 1–12 prizes, 13 finale

// Sound / extras hook: the TV announces each reveal moment (the audio module listens; nothing plays here).
// detail: { what: 'intro' | 'count' (n: 3, 2, 1) | 'walk' | 'spin' | 'show' | 'finale', step, label, preview, back?, empty? }
function emitReveal(detail) {
  try { window.dispatchEvent(new CustomEvent('pw:reveal', { detail })); } catch { /* old browser */ }
}

function Ramp({ value }) {
  return fmt(useRamp(0, Number(value) || 0, 1600, 450));
}

const hero = p => p && { avatar: p.avatar, emoji: p.emoji, name: p.display_name, color: p.color };
const NEEDS = '__needs'; // walk stamp: rated, but short of PODIUM_MIN machines for the podium

// The intro, then all 12 prizes in the order they're decided (one prize each, best prize first): Grand
// Champion, 2nd, 3rd, the six machine champions, The Grinder, The Big Whiff, The Match, then the finale.
// Before each winner, the TV shows that prize's standings and walks down from the top: anyone who already
// won a prize (or, for the podium, has fewer than PODIUM_MIN machines) is stamped and skipped, and it stops
// on the highest person still in the running. A prize nobody can win still gets its slide (the walk runs
// off the end), so the reveal never skips one.
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
  // blocked(row): a stamp for someone who can't win this prize for another reason (NEEDS).
  const walk = (lead, rows, winner, blocked = () => null) => {
    const list = rows.filter(r => r.player);
    const win = winner ? list.findIndex(r => r.player.id === winner.id) : -1;
    return { lead, rows: list.map(r => ({ ...r, won: won.get(r.player.id) || blocked(r) || null })), win };
  };
  const push = (slide, winner) => {
    slides.push(winner ? { ...slide, winnerId: winner.id } : slide);
    if (winner) won.set(winner.id, slide.label);
  };

  slides.push({ label: 'AWARDS CEREMONY', intro: true, hold: true, accent: '#ffcc33', count: PRIZE_COUNT });

  // The podium: PODIUM_MIN+ machines.
  const ranked = standings?.ranked ?? [];
  const byRating = ranked.map(st => ({ player: st.player, value: `${st.rating}/100`, st }));
  const needs = r => (podiumOk(r.st) ? null : NEEDS);
  const short = `nobody has played ${PODIUM_MIN}+ machines yet`;
  const podium = [
    [awards?.champion, 'GRAND CHAMPION', '#ffcc33', '🎉 Woodside Pinball 2026 🎉', short],
    [awards?.second, '2ND PLACE', '#c0c7d4', '🥈', `not enough players with ${PODIUM_MIN}+ machines`],
    [awards?.third, '3RD PLACE', '#cd7f32', '🥉', `not enough players with ${PODIUM_MIN}+ machines`],
  ];
  for (const [st, label, accent, footer, why] of podium) {
    const grand = label === 'GRAND CHAMPION';
    const w = { ...walk('Overall rating', byRating, st?.player, needs), podium: true };
    // The Grand Champion is just the top of the list: a 3-2-1, no walk, unless someone above them on
    // the board is short of machines (then 3-2-1, then the walk shows why they're skipped).
    // 2nd and 3rd walk the ratings.
    const skipsShort = grand && w.rows.slice(0, w.win < 0 ? undefined : w.win).some(r => r.won === NEEDS);
    const gw = grand ? (skipsShort ? w : null) : w;
    if (!st) { push(noWinner(label, accent, why, { walk: gw, walkOnly: !grand })); continue; }
    // The next person in line for this place: when they show the same rating, say how it was decided.
    const next = ranked.find(x => x !== st && podiumOk(x) && !won.has(x.player.id) && ranked.indexOf(x) > ranked.indexOf(st));
    push({
      label, confetti: true, hero: hero(st.player), title: st.player.display_name, accent, footer, walk: gw, walkOnly: !grand,
      trophy: grand, rays: grand,
      subtitle: grand ? `The Pinball Wizard · ${st.crowns} crown${st.crowns === 1 ? '' : 's'}` : `${st.machinesPlayed} machines played`,
      score: `${st.rating}/100`,
      tie: tieBreakNote(st, next),
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

  // The finale: every winner, then free play.
  const prizes = slides.filter(x => !x.intro);
  slides.push({
    label: 'THANK YOU', finale: true, hold: true, accent: '#ffcc33', confetti: true,
    winners: prizes.map(x => ({ prize: x.label, accent: x.accent, player: x.empty ? null : playerOf(x.winnerId) || (x.hero && { display_name: x.hero.name, avatar: x.hero.avatar, emoji: x.hero.emoji, color: x.hero.color }) })),
  });
  return slides;
}
