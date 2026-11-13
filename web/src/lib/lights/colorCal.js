// Hue correction for the real strip. Every color the app sends to WLED (MQTT `api` topic) or writes
// into the generated controller presets passes through `calPayload` / `calColor` once, right before it
// leaves. The simulator, the TV and the config all keep the INTENDED colors.
//
// Why (Matt's bench tests, 2026-11-12; details in LIGHTS.colorCal): on this WS2814 with WLED gamma on,
// red→green mixes drift toward green, green→blue mixes toward blue, blue→red mixes toward pink.
//
// How: the color goes to HSV; value (the max channel), saturation (so the min channel too) and W are
// kept, and only the hue moves along a warp f(intended hue) = hue to send, which is smooth, monotonic
// and continuous around the whole wheel (f(0) = 0, f(360) = 360; red, green and blue stay fixed):
//   0–60°   sent = 60·a·(h/60)^k, a and k fitted exactly through the two measured warm points
//           (orange 255,110,0 → 255,18,0; gold 255,190,0 → 255,54,0)
//   60–120° cubic Hermite up to pure green, matching slopes on both sides
//   120–360° monotone cubic (Fritsch–Carlson) through LIGHTS.colorCal.hueKnots, plus the app's deep
//           violet as a fixed point (so 139,0,200 is sent exactly)
// The warp is weighted by saturation: none below satOff, full from satFull, so white and pale colors
// are barely touched.
import { LIGHTS } from './config.js';

const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// --- HSV keeping the max and min channels exactly -------------------------------------------------
function toHsv(r, g, b) {
  const v = Math.max(r, g, b), mn = Math.min(r, g, b), d = v - mn;
  if (d <= 0) return { h: 0, v, mn, d: 0 };
  let h;
  if (v === r) h = 60 * (((g - b) / d) % 6);
  else if (v === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return { h, v, mn, d };
}
function fromHsv(h, v, mn) {
  const d = v - mn;
  h = ((h % 360) + 360) % 360;
  const x = k => mn + d * k;
  const f = (h % 60) / 60;
  switch (Math.floor(h / 60)) {
    case 0: return [v, x(f), mn];
    case 1: return [x(1 - f), v, mn];
    case 2: return [mn, v, x(f)];
    case 3: return [mn, x(1 - f), v];
    case 4: return [x(f), mn, v];
    default: return [v, mn, x(1 - f)];
  }
}
export const hueOf = c => toHsv(c[0], c[1], c[2]).h;

// --- the warp ---------------------------------------------------------------------------------------
function build(cal) {
  const [p1, p2] = cal.points;
  const t1 = p1.intended[1] / p1.intended[0], s1 = p1.sent[1] / p1.sent[0];
  const t2 = p2.intended[1] / p2.intended[0], s2 = p2.sent[1] / p2.sent[0];
  const k = Math.log(s2 / s1) / Math.log(t2 / t1);
  const a = s1 / Math.pow(t1, k);
  // 120–360 knots (with the fixed violet), monotone slopes by Fritsch–Carlson.
  const pts = [[120, 120], ...(cal.hueKnots || [])];
  if (cal.violet) { const hv = hueOf(cal.violet); pts.push([hv, hv]); }
  pts.push([360, 360]);
  pts.sort((p, q) => p[0] - q[0]);
  const n = pts.length, del = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) del.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  m[0] = del[0]; m[n - 1] = del[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (del[i - 1] * del[i] <= 0) m[i] = 0;
    else { const w1 = 2 * (pts[i + 1][0] - pts[i][0]) + (pts[i][0] - pts[i - 1][0]), w2 = (pts[i + 1][0] - pts[i][0]) + 2 * (pts[i][0] - pts[i - 1][0]); m[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]); }
  }
  return { a, k, pts, m };
}
const cache = new WeakMap();
const model = cal => { if (!cache.has(cal)) cache.set(cal, build(cal)); return cache.get(cal); };

function hermite(x, x0, x1, y0, y1, m0, m1) {
  const hh = x1 - x0, t = (x - x0) / hh, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * hh * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * hh * m1;
}

// Intended hue (degrees) → hue to send, at full saturation.
export function hueWarp(h, cal = LIGHTS.colorCal) {
  const { a, k, pts, m } = model(cal);
  h = ((h % 360) + 360) % 360;
  if (h <= 60) return 60 * a * Math.pow(h / 60, k);
  if (h <= 120) return hermite(h, 60, 120, 60 * a, 120, a * k, m[0]);
  let i = 0;
  while (i < pts.length - 2 && h > pts[i + 1][0]) i++;
  return hermite(h, pts[i][0], pts[i + 1][0], pts[i][1], pts[i + 1][1], m[i], m[i + 1]);
}

// The part of the hue change that applies at this saturation (0..1).
const weight = (sat, cal) => smooth(cal.satOff ?? 0.1, cal.satFull ?? 0.7, sat);
const sentHue = (h, w, cal) => h + w * (hueWarp(h, cal) - h);
const ok = c => Array.isArray(c) && c.length >= 3 && c.slice(0, 3).every(v => typeof v === 'number');

// [r, g, b, w] intended → [r, g, b, w] to send. Anything that isn't a 3–4 number array passes through.
export function calColor(c, cal = LIGHTS.colorCal) {
  if (!cal?.enabled || !ok(c)) return c;
  const { h, v, mn, d } = toHsv(c[0], c[1], c[2]);
  if (d <= 0) return c;
  const w = weight(d / v, cal);
  if (w <= 0) return c;
  const out = c.slice();
  const rgb = fromHsv(sentHue(h, w, cal), v, mn);
  for (let j = 0; j < 3; j++) out[j] = Math.round(rgb[j]);
  return out;
}

// The inverse (sent → intended), for drawing what the strip was told in the simulator's colors.
// Max, min (so saturation and the weight) are the same before and after, so it's a 1-D search on hue.
export function uncalColor(c, cal = LIGHTS.colorCal) {
  if (!cal?.enabled || !ok(c)) return c;
  const { h, v, mn, d } = toHsv(c[0], c[1], c[2]);
  if (d <= 0) return c;
  const w = weight(d / v, cal);
  if (w <= 0) return c;
  let lo = 0, hi = 360;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (sentHue(mid, w, cal) < h) lo = mid; else hi = mid; }
  const out = c.slice();
  const rgb = fromHsv((lo + hi) / 2, v, mn);
  for (let j = 0; j < 3; j++) out[j] = Math.round(rgb[j]);
  return out;
}

// A WLED JSON state message (or one preset): every seg[].col entry corrected. Returns a new object.
function mapPayload(p, fn) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.seg)) return p;
  return { ...p, seg: p.seg.map(s => (s && Array.isArray(s.col) ? { ...s, col: s.col.map(c => fn(c)) } : s)) };
}
export const calPayload = (p, cal = LIGHTS.colorCal) => mapPayload(p, c => calColor(c, cal));
export const uncalPayload = (p, cal = LIGHTS.colorCal) => mapPayload(p, c => uncalColor(c, cal));
