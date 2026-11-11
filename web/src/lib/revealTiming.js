// The reveal's timeline, shared by the screen (components/Reveal.jsx) and its sounds. Every build-up is
// deterministic (3-2-1, the walk down a prize's standings, the Match number roll and slot reel), so the
// sounds are planned from the same numbers the screen uses: the whole slide's sounds are scheduled at once
// (`soundPlan`), which lets the TV play them EARLIER than the picture by the host's "Audio delay" (AirPlay
// buffers ~2 s on the way to the WiiM) and still have them land with the screen in the garage.
// Pure (tested in revealTiming.test.js).
import { stingFor } from './audio/policy.js';

export const COUNT_MS = 1000; // each number of the 3-2-1
export const DRAW_MS = 2600, REEL_MS = 6200, SHORT_REEL_MS = 1800, HOLD_MS = 1300; // The Match
export const WALK_IN = 1100, WALK_HOLD = 1400; // the walk
export const ITEM_H = 120; // MatchSpin item height (px)
export const ease = x => 1 - Math.pow(1 - x, 4);
const unease = y => 1 - Math.pow(1 - Math.max(0, Math.min(1, y)), 1 / 4); // ease⁻¹

export function modeOf(slide) {
  if (!slide) return 'count';
  if (slide.hold) return 'hold';
  if (slide.spin) return 'spin';
  if (!slide.walk?.rows.length) return 'count';
  return slide.walkOnly ? 'walk' : 'countwalk';
}
export function walkTimes(w) {
  const steps = w.win >= 0 ? w.win : w.rows.length; // -1: walk past everyone
  const step = steps ? Math.max(380, Math.min(800, 4200 / steps)) : 0;
  const land = WALK_IN + steps * step;
  const show = Math.max(3200, land + WALK_HOLD);
  return { at: [0, show / 3, (show * 2) / 3], show, step, land };
}
export function spinTimes(spin) {
  const reel = spin.items.length > 1 ? REEL_MS : SHORT_REEL_MS;
  return { at: [0, DRAW_MS, DRAW_MS + reel * 0.55], show: DRAW_MS + reel + HOLD_MS, reel };
}
// The reel strip MatchSpin draws: the items repeated, ending on the winner.
export function reelLength(spin) {
  const n = spin.items.length;
  const reps = n > 1 ? Math.max(2, Math.ceil(26 / n)) : 1;
  return reps * n;
}
// When the winner of a build-up lands (ms from the slide's start).
export function showAt(slide, mode = modeOf(slide)) {
  if (mode === 'hold') return 0;
  if (mode === 'spin') return spinTimes(slide.spin).show;
  if (mode === 'walk') return walkTimes(slide.walk).show;
  if (mode === 'countwalk') return COUNT_MS * 3 + Math.max(1500, walkTimes(slide.walk).land + WALK_HOLD);
  return COUNT_MS * 3;
}

// Every sound of one slide, in ms from the slide's start: [{ at, s }]. `mode` 'hold' with `instant` (Back, or a
// slide this TV already showed) has none.
export function soundPlan(slide, { mode = modeOf(slide), instant = false } = {}) {
  if (!slide || instant) return [];
  const ev = [];
  const sting = s => ev.push({ at: showAt(slide, mode), s: stingFor({ empty: !!s.empty, grand: s.label === 'GRAND CHAMPION', whiff: s.label === 'THE BIG WHIFF' }) });
  if (mode === 'hold') {
    if (slide.intro) ev.push({ at: 0, s: 'introSting' });
    else if (slide.finale) ev.push({ at: 0, s: 'finaleSting' });
    return ev;
  }
  const walk = (base, w) => {
    const { step, land } = walkTimes(w);
    const end = w.win >= 0 ? w.win : w.rows.length;
    // The cursor moves to row k at WALK_IN + k·step (a ratchet each time), then lands (a ding).
    for (let k = 1; k <= Math.min(end, w.rows.length - 1); k++) ev.push({ at: base + WALK_IN + k * step, s: 'step' });
    ev.push({ at: base + land, s: 'land' });
  };
  if (mode === 'count' || mode === 'countwalk') {
    for (let k = 0; k < 3; k++) ev.push({ at: k * COUNT_MS, s: 'tick' });
    if (mode === 'countwalk') walk(COUNT_MS * 3, slide.walk);
  } else if (mode === 'walk') {
    walk(0, slide.walk);
  } else if (mode === 'spin') {
    const { reel } = spinTimes(slide.spin);
    // The number rolls 24 times, slowing down (ease), and lands on the draw.
    for (let i = 1; i < 24; i++) ev.push({ at: Math.round(DRAW_MS * unease(i / 24)), s: 'roll' });
    ev.push({ at: DRAW_MS, s: 'land' });
    // A clack each time a player passes the reel's window (never closer than 45 ms), then the stop.
    const L = reelLength(slide.spin);
    let last = -Infinity;
    for (let j = 0; j < L - 1; j++) {
      const t = DRAW_MS + reel * unease((j + 0.5) / (L - 1));
      if (t - last > 45) { ev.push({ at: Math.round(t), s: 'clack' }); last = t; }
    }
    ev.push({ at: DRAW_MS + reel, s: 'stop' });
  }
  sting(slide);
  return ev.sort((a, b) => a.at - b.at);
}
