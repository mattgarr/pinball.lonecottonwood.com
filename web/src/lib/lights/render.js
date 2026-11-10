// Draws what the strips are doing, from a model of WLED's segments. Used by the simulator.
// It renders the effects the app uses (Solid, Breathe, Wipe, Colorloop, Rainbow, Chase, Chase Rainbow)
// at roughly WLED's timing; anything else shows the segment's color.
import { LIGHTS } from './config.js';

const FX = LIGHTS.effects;

export function newModel() {
  return { on: true, bri: 255, ambient: true, segs: {} }; // ambient = Matt's preset 1 is running
}

// Apply one JSON state message (the same body WLED gets).
export function applyMessage(model, msg) {
  if (!msg || typeof msg !== 'object') return model;
  if (msg.on !== undefined) model.on = !!msg.on;
  if (msg.bri !== undefined) model.bri = msg.bri;
  if (msg.ps !== undefined) model.ambient = true;
  for (const s of msg.seg || []) {
    if (s.stop === 0) { delete model.segs[s.id]; continue; }
    const cur = model.segs[s.id] || { id: s.id, on: false, fx: 0, col: [[255, 160, 0, 0]], bri: 255, sx: 128, since: 0 };
    const next = { ...cur, ...s };
    if (s.fx !== undefined || s.col !== undefined || (s.on && !cur.on)) next.since = performance.now();
    model.segs[s.id] = next;
    if (s.on && (s.id === LIGHTS.runs.top.baseSeg || s.id === LIGHTS.runs.curb.baseSeg) && s.fx !== undefined) model.ambient = false;
  }
  return model;
}

const hsv = (h, s = 1, v = 1) => {
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
};
// RGBW → screen RGB: the white chip shows as warm natural white.
const toRgb = c => {
  const [r, g, b, w = 0] = c || [0, 0, 0, 0];
  return [Math.min(255, r + w), Math.min(255, g + w * 0.93), Math.min(255, b + w * 0.82)];
};

// Color of pixel i (index within the segment, n = its length) at time t (ms since the effect began).
function pixel(seg, i, n, t) {
  const c0 = toRgb(seg.col?.[0]);
  const c1 = toRgb(seg.col?.[1] || [0, 0, 0, 0]);
  const speed = 0.4 + (seg.sx ?? 128) / 128; // faster with sx
  switch (seg.fx) {
    case FX.Breathe: {
      const k = 0.5 - 0.5 * Math.cos((t / 1000) * Math.PI * speed);
      return c0.map((v, j) => c1[j] + (v - c1[j]) * (0.15 + 0.85 * k));
    }
    case FX.Wipe: {
      const cycle = 2200 / speed;
      const pos = ((t % (cycle * 2)) / cycle) * n;
      return pos < n ? (i < pos ? c0 : c1) : (i < pos - n ? c1 : c0);
    }
    case FX.Colorloop: return hsv(((t / 40) * speed) % 360);
    case FX.Rainbow: return hsv((i * (360 / Math.max(n, 1)) + (t / 20) * speed) % 360);
    case FX.Chase: return Math.floor((i + (t / 60) * speed) / 3) % 3 === 0 ? c0 : c1;
    case FX['Chase Rainbow']: return Math.floor((i + (t / 60) * speed) / 3) % 3 === 0 ? hsv((i * 12 + t / 10) % 360) : c0.map(v => v * 0.25);
    case FX.Fade: return c0.map((v, j) => c1[j] + (v - c1[j]) * (0.5 + 0.5 * Math.sin(t / 900)));
    default: return c0;
  }
}

const AMBIENT = (i, n, t) => { // stand-in for Matt's Arcade Attract playlist: purple/magenta/cyan drift
  const hues = [280, 315, 190];
  const h = hues[Math.floor(t / 4000) % 3];
  const k = 0.55 + 0.45 * Math.sin(i / 6 + t / 500);
  return hsv(h, 0.9, k);
};

// Fill `out` (array of [r,g,b]) for pixels [from, to) at time `now` (performance.now()).
export function renderRange(model, from, to, now, timeScale = 1) {
  const out = [];
  const segs = Object.values(model.segs).filter(s => s.on && s.start !== undefined && s.stop > s.start).sort((a, b) => a.id - b.id);
  const g = model.on ? (model.bri ?? 255) / 255 : 0;
  for (let p = from; p < to; p++) {
    let c = [0, 0, 0];
    let top = null;
    for (const s of segs) if (p >= s.start && p < s.stop) top = s; // later (higher id) segments draw on top
    const t = (now - (top?.since || 0)) / timeScale;
    if (top && !(model.ambient && (top.id === LIGHTS.runs.top.baseSeg || top.id === LIGHTS.runs.curb.baseSeg))) {
      c = pixel(top, p - top.start, top.stop - top.start, t).map(v => v * ((top.bri ?? 255) / 255));
    } else if (model.ambient || !top) {
      c = model.ambient ? AMBIENT(p - from, to - from, now / timeScale) : [0, 0, 0];
    }
    out.push(c.map(v => Math.round(v * g)));
  }
  return out;
}
