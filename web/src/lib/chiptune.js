// Tiny 8-bit sound effects made on the fly with WebAudio (square/triangle waves + a noise "knocker").
// Browsers only allow sound after a click, so the TV shows a "click for sound" button once.
let ctx = null;
let on = false;
const KEY = 'pw.tvsound';

const N = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI note -> Hz

function tone(midi, start, dur, { type = 'square', vol = 0.07, slide = 0 } = {}) {
  const t = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(N(midi), t);
  if (slide) o.frequency.linearRampToValueAtTime(N(midi + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.setValueAtTime(vol, t + Math.max(0.02, dur - 0.04));
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// Run of notes: [midi|null, beats] pairs at `step` seconds per beat.
function run(notes, step, opts) {
  let t = 0;
  for (const [n, beats = 1] of notes) {
    if (n != null) tone(n, t, beats * step * 0.95, opts);
    t += beats * step;
  }
  return t;
}

// The pinball "knocker": a short thump plus a noise burst.
function knock(start = 0) {
  const t = ctx.currentTime + start;
  const len = 0.12;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = 0.35;
  src.buffer = buf;
  src.connect(g).connect(ctx.destination);
  src.start(t);
  const o = ctx.createOscillator();
  const og = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
  og.gain.setValueAtTime(0.5, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  o.connect(og).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.2);
}

const play = fn => { if (on && ctx) { try { fn(); } catch { /* ignore */ } } };

export const sfx = {
  // a score was logged
  coin: () => play(() => run([[83, 1], [88, 4]], 0.07)),
  // climbed the board
  climb: () => play(() => run([[72], [76], [79], [84, 3]], 0.06)),
  // new player joined
  join: () => play(() => {
    run([[60], [64], [67], [72], [76], [79], [84, 4]], 0.05, { type: 'square', vol: 0.06 });
    run([[48, 2], [55, 2], [60, 4]], 0.09, { type: 'triangle', vol: 0.1 });
  }),
  // new high score on a machine
  record: () => play(() => {
    knock(0);
    run([[null, 2], [67], [72], [76], [79, 2], [76], [79, 6]], 0.08);
    run([[null, 2], [55, 4], [60, 4], [64, 6]], 0.08, { type: 'triangle', vol: 0.12 });
  }),
  // new overall leader
  leader: () => play(() => {
    knock(0); knock(0.35);
    run([[null, 4], [72], [72], [79, 2], [77], [76], [74], [84, 8], [null, 1], [83], [84, 6]], 0.075);
    run([[null, 4], [48, 4], [55, 4], [53, 4], [48, 8], [55, 7]], 0.075, { type: 'triangle', vol: 0.12 });
  }),
  // party milestone
  milestone: () => play(() => run([[84], [null], [84], [91, 4]], 0.06)),
  // new #1 on the Wall of Shame: sad trombone
  shame: () => play(() => run([[67, 3], [66, 3], [65, 3], [64, 10]], 0.11, { type: 'sawtooth', vol: 0.05 })),
};

// After the Mac sleeps, the browser can suspend the audio: wake it again when the page is visible.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && on && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  });
}

export const sound = {
  wanted: () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } },
  isOn: () => on && !!ctx && ctx.state === 'running',
  async enable() {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume().catch(() => {});
    on = true;
    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    sfx.coin();
  },
  disable() {
    on = false;
    try { localStorage.setItem(KEY, '0'); } catch { /* ignore */ }
  },
};
