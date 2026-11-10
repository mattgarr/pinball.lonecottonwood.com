// Draws what the strips are doing, from a model of WLED's segments. Used by the simulator.
// It approximates the effects the app uses (at roughly WLED's timing); anything else shows the
// segment's color. Sound-reactive effects use `model.audio` ({ level, bands[16], beat }), which the
// simulator fills from the Mac's microphone (or a fake beat).
//
// Effects are drawn by position within their segment, so the beam band and the curb (same length,
// same effect, same start time) draw identically: stacked, like on the wall.
import { LIGHTS } from './config.js';

const FX = LIGHTS.effects;
const { top: TOP, curb: CURB } = LIGHTS.runs;
const AMBIENT_IDS = [TOP.baseSeg, TOP.bandSeg, CURB.baseSeg];

export function newModel() {
  return { on: true, bri: 255, ambient: true, segs: {}, audio: { level: 0, bands: new Array(16).fill(0), beat: false }, hist: {} };
}

// Apply one JSON state message (the same body WLED gets).
export function applyMessage(model, msg) {
  if (!msg || typeof msg !== 'object') return model;
  if (msg.on !== undefined) model.on = !!msg.on;
  if (msg.bri !== undefined) model.bri = msg.bri;
  if (msg.ps !== undefined) model.ambient = true;
  const now = performance.now();
  for (const s of msg.seg || []) {
    if (s.stop === 0) { delete model.segs[s.id]; continue; }
    const cur = model.segs[s.id] || { id: s.id, on: false, fx: 0, col: [[255, 160, 0, 0]], bri: 255, sx: 128, since: 0 };
    const next = { ...cur, ...s };
    if (s.fx !== undefined || s.col !== undefined || (s.on && !cur.on)) next.since = now;
    model.segs[s.id] = next;
    if (s.on && AMBIENT_IDS.includes(s.id) && s.fx !== undefined) model.ambient = false;
  }
  return model;
}

const hsv = (h, s = 1, v = 1) => {
  h = ((h % 360) + 360) % 360;
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
};
// RGBW → screen RGB: the white chip shows as bright natural white.
const toRgb = c => {
  const [r, g, b, w = 0] = c || [0, 0, 0, 0];
  return [Math.min(255, r + w), Math.min(255, g + w * 0.95), Math.min(255, b + w * 0.88)];
};
const mix = (a, b, k) => a.map((v, j) => v + (b[j] - v) * k);
const hash = (a, b = 0) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

// Approximate WLED palettes (pal ids from the config) as a list of stops.
const PALETTES = {
  6: [[85, 0, 171], [132, 0, 124], [181, 0, 75], [229, 0, 27], [232, 23, 0], [184, 71, 0], [171, 119, 0], [171, 171, 0], [171, 85, 0], [221, 34, 0], [242, 0, 14], [194, 0, 62], [143, 0, 113], [95, 0, 161], [47, 0, 208], [0, 7, 249]], // Party
  50: [[1, 5, 45], [0, 200, 23], [0, 255, 0], [0, 243, 45], [0, 135, 7], [1, 5, 45]], // Aurora
  56: [[227, 1, 1], [227, 1, 1], [71, 1, 193], [32, 1, 255], [2, 15, 255]], // Retro Clown
  57: [[229, 227, 1], [227, 101, 3], [40, 2, 80], [80, 2, 220], [255, 0, 170]], // Candy
};
const palColor = (seg, x) => { // x in 0..1, wraps. pal 4 = "Color Gradient": the segment's own colors
  const p = seg.pal === 4 && seg.col?.length ? seg.col.slice(0, 3).map(toRgb) : PALETTES[seg.pal] || PALETTES[6];
  const f = (((x % 1) + 1) % 1) * p.length;
  const i = Math.floor(f);
  return mix(p[i % p.length], p[(i + 1) % p.length], f - i);
};

// Rolling history for "flowing" sound effects, shared by every segment with the same effect and length
// (so the band and the curb stay identical).
function history(model, key, n, now, fill, fromCenter) {
  let h = model.hist[key];
  if (!h || h.px.length !== n) h = model.hist[key] = { px: Array.from({ length: n }, () => [0, 0, 0]), last: 0 };
  if (now - h.last > 30) {
    h.last = now;
    const c = fill();
    if (fromCenter) {
      const m = Math.floor(n / 2);
      for (let i = 0; i < m; i++) h.px[i] = h.px[i + 1] || c; // shift outward from the center
      for (let i = n - 1; i > m; i--) h.px[i] = h.px[i - 1] || c;
      h.px[m] = c;
    } else {
      h.px.pop(); h.px.unshift(c);
    }
  }
  return h.px;
}

// Color of pixel i (index within the segment, n = its length).
function pixel(model, seg, i, n, t, now) {
  const c0 = toRgb(seg.col?.[0]);
  const c1 = toRgb(seg.col?.[1] || [0, 0, 0, 0]);
  const speed = 0.4 + (seg.sx ?? 128) / 128;
  const x = i / Math.max(n - 1, 1);
  const A = model.audio || { level: 0, bands: [], beat: false };
  switch (seg.fx) {
    case FX.Breathe: { const k = 0.5 - 0.5 * Math.cos((t / 1000) * Math.PI * speed); return mix(c1, c0, 0.15 + 0.85 * k); }
    case FX.Wipe: { const cycle = 2200 / speed; const pos = ((t % (cycle * 2)) / cycle) * n; return pos < n ? (i < pos ? c0 : c1) : (i < pos - n ? c1 : c0); }
    case FX.Colorloop: return hsv((t / 40) * speed);
    case FX.Rainbow: return hsv(x * 360 + (t / 20) * speed);
    case FX.Chase: { // blocks alternating through the segment's colors (three if given)
      const cols = (seg.col || []).slice(0, 3).map(toRgb);
      const k = Math.floor((i + (t / 60) * speed) / 3);
      return cols.length >= 3 ? cols[((k % 3) + 3) % 3] : k % 3 === 0 ? c0 : c1;
    }
    case FX['Chase Rainbow']: return Math.floor((i + (t / 60) * speed) / 3) % 3 === 0 ? hsv(i * 12 + t / 10) : c0.map(v => v * 0.25);
    case FX.Fade: return mix(c1, c0, 0.5 + 0.5 * Math.sin(t / 900));
    // ambient rotation
    case FX.Colorwaves: return palColor(seg, x * 1.5 + Math.sin(t / 3000) * 0.5 + t / 9000).map(v => v * (0.6 + 0.4 * Math.sin(x * 9 - t / 600)));
    case FX.Plasma: return palColor(seg, 0.5 + 0.25 * Math.sin(x * 7 + t / 1300) + 0.25 * Math.sin(x * 3 - t / 900));
    case FX.Pacifica: { const w = 0.5 + 0.5 * Math.sin(x * 11 + t / 700) * Math.sin(x * 5 - t / 1100); return mix([0, 20, 60], [40, 180, 200], w); }
    case FX.Flow: return palColor(seg, x + t / 5000).map(v => v * (Math.floor(x * 12 + t / 400) % 2 ? 1 : 0.35));
    case FX.Aurora: { const w = Math.max(0, Math.sin(x * 6 + t / 1500)) * Math.max(0, Math.sin(x * 2.3 - t / 2600 + 1)); return palColor(seg, x * 0.6 + t / 12000).map(v => v * (0.15 + 0.85 * w)); }
    case FX.Twinklefox: { const slot = Math.floor(t / 900 + hash(i) * 7); const k = Math.sin(((t / 900 + hash(i) * 7) % 1) * Math.PI); return palColor(seg, hash(i, slot)).map(v => v * k * (hash(i, slot + 1) > 0.35 ? 1 : 0.1)); }
    case FX['Pride 2015']: return hsv(x * 240 + t / 25, 0.85, 0.55 + 0.45 * Math.sin(x * 4 + t / 800));
    // sound-reactive
    case FX.Gravcentric: { // VU meter from the center out, colored by distance
      const h = model.hist[`grav:${n}`] ||= { peak: 0 };
      h.peak = Math.max(A.level, h.peak * 0.985);
      const d = Math.abs(i - n / 2) / (n / 2);
      return d <= A.level ? palColor(seg, d) : d <= h.peak && d > h.peak - 0.04 ? [255, 255, 255] : [0, 0, 0];
    }
    case FX.Gravimeter: return x <= A.level ? palColor(seg, x) : [0, 0, 0];
    case FX.Waterfall: return history(model, `wf:${n}`, n, now, () => { const b = dominant(A); return A.beat ? [255, 255, 255] : palColor(seg, b / 16).map(v => v * A.level); }, false)[i];
    case FX.Freqwave: return history(model, `fw:${n}`, n, now, () => palColor(seg, dominant(A) / 16).map(v => v * Math.min(1, A.level * 1.3)), true)[i];
    case FX['DJ Light']: return history(model, `dj:${n}`, n, now, () => { const b = A.bands; return [255 * avg(b, 0, 3), 255 * avg(b, 4, 9), 255 * avg(b, 10, 15)].map(v => Math.min(255, v * 1.6)); }, true)[i];
    case FX.Puddlepeak: { const h = model.hist[`pud:${n}`] ||= { at: -1e9, pos: 0, hue: 0 }; if (A.beat && now - h.at > 120) { h.at = now; h.pos = hash(now) ; h.hue = hash(now, 3); } const age = (now - h.at) / 600; const d = Math.abs(x - h.pos) * n; return age < 1 && d < 6 * (1 - age) + 1 ? palColor(seg, h.hue).map(v => v * (1 - age)) : [0, 0, 0]; }
    case FX.Pixelwave: return history(model, `pw:${n}`, n, now, () => palColor(seg, A.level).map(v => v * A.level), true)[i];
    default: return c0;
  }
}
const avg = (a, s, e) => { let t = 0; for (let i = s; i <= e; i++) t += a[i] || 0; return t / (e - s + 1); };
const dominant = A => { let best = 0; (A.bands || []).forEach((v, i) => { if (v > (A.bands[best] || 0)) best = i; }); return best; };

const AMBIENT = (i, n, t) => { // stand-in for Matt's Arcade Attract playlist: purple/pink/turquoise drift
  const hues = [270, 320, 175];
  return hsv(hues[Math.floor(t / 4000) % 3], 0.9, 0.55 + 0.45 * Math.sin(i / 6 + t / 500));
};

// Colors ([r,g,b]) for pixels [from, to) at time `now` (performance.now()).
export function renderRange(model, from, to, now, timeScale = 1) {
  const out = [];
  // Like WLED: every segment with pixels draws, and a switched-off one paints black over those below.
  const segs = Object.values(model.segs).filter(s => s.start !== undefined && s.stop > s.start).sort((a, b) => a.id - b.id);
  const g = model.on ? (model.bri ?? 255) / 255 : 0;
  for (let p = from; p < to; p++) {
    let top = null;
    for (const s of segs) if (p >= s.start && p < s.stop) top = s; // higher ids draw on top
    let c;
    if (top && !top.on) {
      c = [0, 0, 0];
    } else if (top && !(model.ambient && AMBIENT_IDS.includes(top.id))) {
      const t = (now - (top.since || 0)) / timeScale;
      const n = top.stop - top.start;
      // WLED draws effect pixel i at physical pixel i + offset, so physical r shows effect pixel r - offset.
      const shift = LIGHTS.wledOffsetAdds === false ? (top.of || 0) : -(top.of || 0);
      let idx = (((p - top.start + shift) % n) + n) % n;
      let len = n;
      if (top.mi) { len = Math.ceil(n / 2); if (idx >= len) idx = n - 1 - idx; } // mirrored halves
      if (top.rev) idx = len - 1 - idx;
      c = pixel(model, top, idx, len, t, now).map(v => v * ((top.bri ?? 255) / 255));
    } else {
      c = model.ambient ? AMBIENT(p - from, to - from, now / timeScale) : [0, 0, 0];
    }
    out.push(c.map(v => Math.max(0, Math.min(255, Math.round(v * g)))));
  }
  return out;
}
