// The director's own sounds, synthesized with WebAudio (same 8-bit palette as lib/chiptune.js, same
// AudioContext and effects bus, so the host's effects volume covers them all).
//   blip         a tiny tick (test / small moment)
//   attention    a pleasant two-note arcade chime for big moments (≈0.9 s)
//   chime        three-note "ding-dong-ding" before an announcement (≈0.9 s)
//   fanfare      the tournament start (≈1.6 s)
//   boop {n}     one per second of the final countdown, rising (n = 10 … 1)
//   endBeep      the long BEEEP at zero (≈1.5 s)
//   tick         reveal 3-2-1 tick           step   a ratchet click per walk row
//   roll         the Match number roll tick  clack  a slot-reel clack     stop   the reel stops
//   land         a walk / roll landing ding
//   sting        a winner                    grandSting  the Grand Champion (bigger)
//   whiff        The Big Whiff (a friendly sad trombone)   noWinner  an empty prize
//   introSting / finaleSting  the reveal's opening and closing
import { audioCtx, fxBus } from '../chiptune.js';

const N = n => 440 * Math.pow(2, (n - 69) / 12);
let live = new Set(); // playing nodes, for stop()

function node(n) { live.add(n); n.onended = () => live.delete(n); return n; }

function tone(ctx, out, midi, start, dur, { type = 'square', vol = 0.07, slide = 0, attack = 0.008, decay = null, vibrato = 0 } = {}) {
  const t = ctx.currentTime + start;
  const o = node(ctx.createOscillator());
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(N(midi), t);
  if (slide) o.frequency.linearRampToValueAtTime(N(midi + slide), t + dur);
  if (vibrato) {
    const lfo = node(ctx.createOscillator()), lg = ctx.createGain();
    lfo.frequency.value = 6; lg.gain.value = N(midi) * vibrato;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t); lfo.stop(t + dur + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  if (decay) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * decay), t + dur);
  else { g.gain.setValueAtTime(vol, t + Math.max(attack + 0.01, dur - 0.05)); g.gain.linearRampToValueAtTime(0.0001, t + dur); }
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.03);
}

// A bell-ish note: a sine plus a quiet square an octave up, both decaying.
function bell(ctx, out, midi, start, dur, vol = 0.16) {
  tone(ctx, out, midi, start, dur, { type: 'sine', vol, decay: 0.01, attack: 0.004 });
  tone(ctx, out, midi + 12, start, dur * 0.6, { type: 'triangle', vol: vol * 0.35, decay: 0.01, attack: 0.004 });
}

function noise(ctx, out, start, len, { vol = 0.2, lo = 800, hi = 6000, curve = 3 } = {}) {
  const t = ctx.currentTime + start;
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * len)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, curve);
  const src = node(ctx.createBufferSource());
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = Math.sqrt(lo * hi); bp.Q.value = 0.9;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(bp).connect(g).connect(out);
  src.start(t);
}

function thump(ctx, out, start, { from = 160, to = 45, vol = 0.45, len = 0.18 } = {}) {
  const t = ctx.currentTime + start;
  const o = node(ctx.createOscillator()), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + len);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len + 0.03);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + len + 0.05);
}

function run(ctx, out, notes, step, opts, start = 0) {
  let t = start;
  for (const [n, beats = 1] of notes) {
    if (n != null) tone(ctx, out, n, t, beats * step * 0.95, opts);
    t += beats * step;
  }
  return t;
}

const SOUNDS = {
  blip: (c, o) => tone(c, o, 88, 0, 0.06, { vol: 0.05 }),
  attention: (c, o) => { bell(c, o, 79, 0, 0.7, 0.14); bell(c, o, 84, 0.16, 0.8, 0.14); tone(c, o, 91, 0.16, 0.12, { vol: 0.03 }); },
  chime: (c, o) => { bell(c, o, 84, 0, 0.6); bell(c, o, 79, 0.28, 0.6); bell(c, o, 88, 0.56, 0.9); },
  fanfare: (c, o) => {
    thump(c, o, 0);
    run(c, o, [[67], [72], [76], [79, 2], [76], [79, 2], [84, 6]], 0.085, { vol: 0.07 });
    run(c, o, [[48, 3], [55, 3], [60, 3], [64, 6]], 0.085, { type: 'triangle', vol: 0.13 });
  },
  boop: (c, o, { n = 5 } = {}) => {
    // 10 … 4: a steady boop climbing a semitone a second; 3, 2, 1: louder and brighter.
    const k = 10 - Math.max(1, Math.min(10, n));
    const loud = n <= 3;
    tone(c, o, 69 + k, 0, loud ? 0.22 : 0.16, { type: 'square', vol: loud ? 0.1 : 0.07 });
    tone(c, o, 57 + k, 0, loud ? 0.22 : 0.16, { type: 'triangle', vol: 0.12 });
  },
  endBeep: (c, o) => {
    tone(c, o, 81, 0, 1.4, { type: 'square', vol: 0.09, vibrato: 0.004 });
    tone(c, o, 69, 0, 1.4, { type: 'sawtooth', vol: 0.05 });
    tone(c, o, 57, 0, 1.5, { type: 'triangle', vol: 0.15 });
    thump(c, o, 0, { vol: 0.5 });
  },
  tick: (c, o) => { tone(c, o, 96, 0, 0.05, { type: 'square', vol: 0.06 }); noise(c, o, 0, 0.04, { vol: 0.12, lo: 2500, hi: 8000 }); },
  step: (c, o) => { noise(c, o, 0, 0.035, { vol: 0.22, lo: 1500, hi: 5000, curve: 6 }); tone(c, o, 76, 0, 0.04, { vol: 0.035 }); },
  roll: (c, o) => tone(c, o, 91, 0, 0.03, { vol: 0.035 }),
  clack: (c, o) => { noise(c, o, 0, 0.05, { vol: 0.28, lo: 600, hi: 3000, curve: 5 }); thump(c, o, 0, { from: 220, to: 90, vol: 0.12, len: 0.05 }); },
  stop: (c, o) => { thump(c, o, 0, { from: 120, to: 40, vol: 0.5 }); noise(c, o, 0, 0.12, { vol: 0.3, lo: 300, hi: 2000 }); },
  land: (c, o) => bell(c, o, 88, 0, 0.5, 0.12),
  sting: (c, o) => {
    thump(c, o, 0);
    run(c, o, [[72], [76], [79], [84, 4]], 0.07, { vol: 0.07 });
    run(c, o, [[48, 3], [55, 4]], 0.07, { type: 'triangle', vol: 0.13 });
  },
  grandSting: (c, o) => {
    thump(c, o, 0); thump(c, o, 0.35);
    run(c, o, [[null, 4], [72], [72], [79, 2], [77], [76], [74], [84, 8], [null, 1], [83], [84, 10]], 0.075, { vol: 0.075 });
    run(c, o, [[null, 4], [48, 4], [55, 4], [53, 4], [48, 8], [55, 4], [60, 10]], 0.075, { type: 'triangle', vol: 0.14 });
    for (let i = 0; i < 6; i++) bell(c, o, 96 - (i % 3) * 5, 2.4 + i * 0.09, 0.4, 0.05);
  },
  introSting: (c, o) => { run(c, o, [[60], [64], [67], [72], [76], [79], [84, 6]], 0.06, { vol: 0.06 }); run(c, o, [[36, 6], [48, 8]], 0.06, { type: 'triangle', vol: 0.14 }); },
  finaleSting: (c, o) => SOUNDS.grandSting(c, o),
  whiff: (c, o) => run(c, o, [[67, 3], [66, 3], [65, 3], [64, 9]], 0.1, { type: 'sawtooth', vol: 0.05, vibrato: 0.003 }),
  noWinner: (c, o) => { tone(c, o, 72, 0, 0.18, { type: 'triangle', vol: 0.12 }); tone(c, o, 67, 0.2, 0.4, { type: 'triangle', vol: 0.12 }); },
};

export const SOUND_NAMES = Object.keys(SOUNDS);

export function playSound(name, opts) {
  const c = audioCtx(), o = fxBus();
  const fn = SOUNDS[name];
  if (!c || !o || !fn || c.state !== 'running') return false;
  try { fn(c, o, opts || {}); return true; } catch { return false; }
}

export function stopSounds() {
  for (const n of live) { try { n.stop(); } catch { /* already stopped */ } }
  live = new Set();
}
