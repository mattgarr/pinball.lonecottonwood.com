// Warm-color correction for the real strip. Every color the app sends to WLED (MQTT `api` topic) or
// writes into the generated controller presets passes through `calPayload` / `calColor` once, right
// before it leaves. The simulator, the TV and the config all keep the INTENDED colors.
//
// Why: on Matt's WS2814 (BRG + swap W/G, WLED gamma 2.8) green is far too strong next to red, so
// red+green mixes drift toward yellow / green: (255,110,0) "orange" looks yellow, (255,200,0) looks
// light green. Cool colors (cyan, blue, purple, pink, green) look right and are left alone.
//
// The model: for a red-dominant color, t = g / r (0 = red, 1 = yellow). The sent ratio is
// t' = a·t^k, with a and k fitted exactly through the two measured points in LIGHTS.colorCal
// (a power curve through the origin: red stays red, smooth, monotonic). Past yellow (green dominant,
// u = r / g) the hue walks on to pure green with a cubic Hermite that matches the curve's slope at
// yellow and lands exactly on green with slope 1, so there are no jumps or kinks anywhere on the
// red → yellow → green arc and pure green is unchanged.
//   Hue parameter s: 0 = red, 1 = yellow (r = g), 2 = green. s ≤ 1: s = t; s > 1: s = 2 − u.
// Blue fades the correction out: none once blue reaches `blueOff` of max(r, g), full below `blueFull`
// (smoothstep between), so pinks, purples, cyans, blues and whites are untouched. The brighter of r/g
// and the W channel are never changed.
import { LIGHTS } from './config.js';

const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// a, k from the two measured points (t1 → t1', t2 → t2'), all as fractions of red.
function fit(cal) {
  const [p1, p2] = cal.points;
  const t1 = p1.intended[1] / p1.intended[0], s1 = p1.sent[1] / p1.sent[0];
  const t2 = p2.intended[1] / p2.intended[0], s2 = p2.sent[1] / p2.sent[0];
  const k = Math.log(s2 / s1) / Math.log(t2 / t1);
  const a = s1 / Math.pow(t1, k);
  return { a, k };
}

const fits = new WeakMap();
function model(cal) {
  if (!fits.has(cal)) fits.set(cal, fit(cal));
  return fits.get(cal);
}

// The hue curve s → s' on [0, 2] (0 red, 1 yellow, 2 green).
export function hueCurve(s, cal = LIGHTS.colorCal) {
  const { a, k } = model(cal);
  if (s <= 0) return 0;
  if (s <= 1) return a * Math.pow(s, k);
  if (s >= 2) return s;
  // Cubic Hermite from (1, a) with slope a·k to (2, 2) with slope 1.
  const h = s - 1, h2 = h * h, h3 = h2 * h;
  const y0 = a, y1 = 2, m0 = a * k, m1 = 1;
  return (2 * h3 - 3 * h2 + 1) * y0 + (h3 - 2 * h2 + h) * m0 + (-2 * h3 + 3 * h2) * y1 + (h3 - h2) * m1;
}

// How much of the correction applies to this color (1 = full, 0 = none), from its blue content.
function weight(m, b, cal) {
  if (m <= 0) return 0;
  return 1 - smooth(cal.blueFull, cal.blueOff, b / m);
}

const toS = (r, g) => (r >= g ? (r > 0 ? g / r : 0) : 2 - r / g);
function fromS(s, m) {
  if (s <= 1) return [m, m * s];
  return [m * (2 - s), m];
}

// [r, g, b, w] intended → [r, g, b, w] to send. Anything that isn't a 3–4 number array passes through.
export function calColor(c, cal = LIGHTS.colorCal) {
  if (!cal?.enabled || !Array.isArray(c) || c.length < 3 || !c.every(v => typeof v === 'number')) return c;
  const [r, g, b] = c;
  const m = Math.max(r, g);
  const w = weight(m, b, cal);
  if (w <= 0 || m <= 0) return c;
  const s = toS(r, g);
  const s2 = s + w * (hueCurve(s, cal) - s);
  const [r2, g2] = fromS(s2, m);
  const out = c.slice();
  out[0] = Math.round(r2); out[1] = Math.round(g2);
  return out;
}

// The inverse (sent → intended), for drawing what the strip was told in the simulator's colors.
export function uncalColor(c, cal = LIGHTS.colorCal) {
  if (!cal?.enabled || !Array.isArray(c) || c.length < 3 || !c.every(v => typeof v === 'number')) return c;
  const [r, g, b] = c;
  const m = Math.max(r, g);
  const w = weight(m, b, cal); // max(r, g) and b are kept by calColor, so the weight is the same
  if (w <= 0 || m <= 0) return c;
  const target = toS(r, g);
  let lo = 0, hi = 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const v = mid + w * (hueCurve(mid, cal) - mid);
    if (v < target) lo = mid; else hi = mid;
  }
  const [r2, g2] = fromS((lo + hi) / 2, m);
  const out = c.slice();
  out[0] = Math.round(r2); out[1] = Math.round(g2);
  return out;
}

// A WLED JSON state message (or one preset): every seg[].col entry corrected. Returns a new object.
function mapPayload(p, fn) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.seg)) return p;
  return { ...p, seg: p.seg.map(s => (s && Array.isArray(s.col) ? { ...s, col: s.col.map(c => fn(c)) } : s)) };
}
export const calPayload = (p, cal = LIGHTS.colorCal) => mapPayload(p, c => calColor(c, cal));
export const uncalPayload = (p, cal = LIGHTS.colorCal) => mapPayload(p, c => uncalColor(c, cal));
