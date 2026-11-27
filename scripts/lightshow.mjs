// The laptop's music looks, drawn here frame by frame and streamed to the controller over DDP (UDP
// 4048, 60 frames a second), so they can do what WLED's built-in effects can't: one LED at a time,
// sub-pixel motion, hard contrast. Everything starts from the machines' middle (between Cactus Canyon
// and Whirlwind); the curb draws what's directly above it.
//
//   pulses    Shockwaves: each kick fires a bright pulse with a fading tail out to both walls; snares
//             and hats send small fast sparks.
//   wave      Color by pitch: each moment's pitch color, as bright as the music is loud, flows outward
//             at a steady speed, smoothly blended.
//   spectrum  Spectrum bloom: the 16 frequency bands from the center out (bass in the middle, treble
//             at the walls), each glowing with its level, with a falling peak marker.
//   fireworks each kick bursts a white flash somewhere along the strip into colored sparks that
//             drift, slow and twinkle out; hats are single twinkles.
//   storm     Thunderstorm: dark blue embers; big hits strike jagged white lightning across part of
//             the room (re-striking once or twice), small hits flicker distant purple; hats are rain.
//   comets    Comet chase: each beat launches a comet whose speed follows the music's energy; comets
//             bounce off the walls a few times and fade.
//
// music-sync.mjs feeds the (speaker-delayed) analysis and decides when it runs: only while the host's
// music mode is one of these and nothing else (a score flash, house lights, the reveal) is showing.
import dgram from 'node:dgram';
import { LIGHTS, beamOf, curbOffset } from '../web/src/lib/lights/config.js';
import { calColor } from '../web/src/lib/lights/colorCal.js';

const FPS = 60;
const GAMMA = 2.4; // WLED leaves streamed colors alone: do its gamma here (darker darks, more contrast)

const hsv = (h, s, v) => { // h 0–360, s/v 0–1 → [r, g, b] 0–255
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map(x => x * 255);
};
// Low notes red/orange, mids green/teal, highs blue/violet.
const hueFor = hz => { const t = Math.max(0, Math.min(1, Math.log(Math.max(hz, 80) / 80) / Math.log(4000 / 80))); return 10 + t * 270; };
const rnd = (a, b) => a + Math.random() * (b - a);

export class LightShow {
  constructor({ host, zones, port = 4048 }) {
    this.host = host; this.port = port;
    const { top, curb } = LIGHTS.runs;
    this.count = curb.start + (top.stop - top.start); // the controller's LEDs
    const z = zones.top.find(t => t.machineId === LIGHTS.musicCenterAfter) || zones.top[Math.floor(zones.top.length / 2)];
    this.origin = z.stop; // top-run pixel everything starts from
    this.curbD = beamOf(LIGHTS).start - top.start + curbOffset(zones, LIGHTS); // curb pixel k sits under top pixel k + d
    // Signed distance from the origin for every LED (the curb uses the top pixel above it).
    this.xs = Float32Array.from({ length: this.count }, (_, i) => (i < curb.start ? i - top.start : i - curb.start + this.curbD) - this.origin);
    this.left = top.start - this.origin; this.right = top.stop - 1 - this.origin; // the walls' ends
    this.reach = Math.max(-this.left, this.right) + 8;
    this.mode = 'pulses';
    this.reset();
    this.sock = dgram.createSocket('udp4');
    this.buf = Buffer.alloc(10 + this.count * 3);
    this.seq = 0; this.timer = null; this.lastT = Date.now();
  }

  reset() {
    this.parts = []; this.hist = []; this.glow = 0; this.glowHue = 30;
    this.bands = new Float32Array(16); this.peaks = new Float32Array(16);
    this.energy = 0; this.bolts = []; this.flash = 0; this.flashHue = 270;
  }

  // One analysis frame, already delayed to match the speakers:
  // { vol 0–255, bands[16] 0–255, beat, hat, hz, strength 0–1 }.
  feed(f) {
    const now = Date.now(), hue = hueFor(f.hz), loud = f.vol / 255;
    this.energy = this.energy * 0.97 + loud * 0.03;
    this.glow = Math.max(this.glow * 0.85, loud ** 1.2);
    this.glowHue = this.glowHue * 0.9 + hue * 0.1;
    // Color by pitch history.
    this.hist.push([now, hue, Math.min(1, 0.08 + 1.05 * loud ** 0.8 * (f.beat ? 1.2 : 1))]);
    const keep = (this.reach / 95) * 1000 + 500;
    while (this.hist.length > 2 && now - this.hist[0][0] > keep) this.hist.shift();
    // Spectrum: fast attack, slower release; peaks hold, then fall.
    if (f.bands) for (let i = 0; i < 16; i++) { const v = f.bands[i] / 255; this.bands[i] = v > this.bands[i] ? v : this.bands[i] * 0.9 + v * 0.1; if (v > this.peaks[i]) this.peaks[i] = v; }
    const strength = Math.min(1, 0.5 + 0.5 * (f.strength || 0));
    const m = this.mode;
    if (m === 'pulses') {
      if (f.beat) for (const dir of [-1, 1]) this.parts.push({ t0: now, dir, v: 150, hue, sat: 1, amp: strength, w: 1.6, tail: 22 });
      if (f.hat) for (const dir of [-1, 1]) this.parts.push({ t0: now, dir, v: 230, hue: (hue + 180) % 360, sat: 0.55, amp: 0.45, w: 0.9, tail: 6 });
    } else if (m === 'fireworks') {
      if (f.beat) {
        const x = rnd(this.left + 10, this.right - 10), base = rnd(0, 360);
        this.parts.push({ kind: 'flash', t0: now, x, life: 180 });
        const n = Math.round(8 + 10 * strength);
        for (let k = 0; k < n; k++) this.parts.push({ kind: 'spark', t0: now, x, v: rnd(-1, 1) * rnd(40, 170), hue: (base + rnd(-35, 35) + 360) % 360, life: rnd(900, 1800) });
      }
      if (f.hat) this.parts.push({ kind: 'twinkle', t0: now, x: rnd(this.left, this.right), hue: rnd(0, 360), life: 260 });
    } else if (m === 'storm') {
      if (f.beat && (f.strength || 0) > 0.45) {
        const x = rnd(this.left, this.right), len = rnd(25, 110), dir = Math.random() < 0.5 ? -1 : 1;
        this.bolts.push({ t0: now, x, len, dir, jag: Array.from({ length: 140 }, () => rnd(0.2, 1)), strikes: [0, rnd(70, 120), rnd(170, 260)].slice(0, Math.random() < 0.5 ? 2 : 3) });
      } else if (f.beat) { this.flash = 0.22; this.flashHue = rnd(250, 290); }
      if (f.hat) this.parts.push({ kind: 'rain', t0: now, x: rnd(this.left, this.right), dir: Math.random() < 0.5 ? -1 : 1 });
    } else if (m === 'comets') {
      if (f.beat) {
        this.flipDir = -(this.flipDir || 1);
        this.parts.push({ t0: now, x: 0, dir: this.flipDir, v: 70 + 260 * Math.min(1, this.energy * 1.6), hue, life: 3200, trail: [] });
      }
    }
    if (this.parts.length > 160) this.parts.splice(0, this.parts.length - 160);
    if (this.bolts.length > 4) this.bolts.shift();
  }

  render(now) {
    const n = this.count, r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
    const dt = Math.min(0.1, (now - this.lastT) / 1000); this.lastT = now;
    const add = (i, c, k) => { if (k <= 0) return; r[i] += c[0] * k; g[i] += c[1] * k; b[i] += c[2] * k; };
    // A soft dot of light at distance x (sub-pixel), width w.
    const dot = (x, c, k, w = 1) => { for (let i = 0; i < n; i++) { const d = this.xs[i] - x; if (d > -3 * w && d < 3 * w) add(i, c, k * Math.exp(-(d * d) / (2 * w * w))); } };
    const m = this.mode;
    if (m === 'wave') this.drawWave(now, add);
    else if (m === 'spectrum') this.drawSpectrum(dt, add);
    else if (m === 'pulses') {
      this.glow *= 0.97;
      const gc = hsv(this.glowHue, 0.9, 1);
      for (let i = 0; i < n; i++) { const x = this.xs[i]; if (Math.abs(x) < 6) add(i, gc, this.glow * 0.7 * Math.exp(-(x * x) / 8)); }
      this.parts = this.parts.filter(p => (now - p.t0) / 1000 * p.v < this.reach + p.tail * 3);
      for (const p of this.parts) {
        const head = p.dir * (now - p.t0) / 1000 * p.v, c = hsv(p.hue, p.sat, 1);
        const fade = p.amp * Math.max(0.25, 1 - Math.abs(head) / (this.reach * 1.4));
        for (let i = 0; i < n; i++) {
          const behind = (head - this.xs[i]) * p.dir; // >0: behind the head (toward the center)
          if (behind < -4 * p.w || behind > p.tail * 4) continue;
          const h2 = Math.exp(-(behind * behind) / (2 * p.w * p.w));
          add(i, c, fade * (behind < 0 ? h2 : Math.max(h2, 0.6 * Math.exp(-behind / p.tail))));
        }
      }
    } else if (m === 'fireworks') {
      this.parts = this.parts.filter(p => now - p.t0 < p.life);
      for (const p of this.parts) {
        const a = (now - p.t0) / p.life;
        if (p.kind === 'flash') dot(p.x, [255, 255, 255], (1 - a) ** 2, 1.5 + 4 * a);
        else if (p.kind === 'twinkle') dot(p.x, hsv(p.hue, 0.4, 1), Math.sin(Math.PI * a) * 0.6, 0.7);
        else { // spark: decelerates, fades, twinkles near the end
          const t = (now - p.t0) / 1000, x = p.x + p.v * (1 - Math.exp(-2.2 * t)) / 2.2;
          const tw = a > 0.6 ? (Math.random() < 0.5 ? 0.3 : 1) : 1;
          dot(x, hsv(p.hue, a < 0.08 ? 0.2 : 1, 1), (1 - a) ** 1.5 * tw, 0.8);
        }
      }
    } else if (m === 'storm') {
      // Embers: slow, dim blue noise that swells a little with the music.
      const t = now / 1000, ember = 0.32 + 0.3 * this.glow; // (gamma makes these a dim glow)
      for (let i = 0; i < n; i++) { const x = this.xs[i]; const v = 0.5 + 0.5 * Math.sin(x * 0.21 + t * 0.7) * Math.sin(x * 0.07 - t * 0.4); add(i, [20, 50, 255], ember * v * v); }
      this.glow *= 0.98;
      if (this.flash > 0.01) { const c = hsv(this.flashHue, 0.7, 1); for (let i = 0; i < n; i++) add(i, c, this.flash); this.flash *= 0.8; }
      this.bolts = this.bolts.filter(bo => now - bo.t0 < 600);
      for (const bo of this.bolts) {
        const age = now - bo.t0;
        const on = bo.strikes.some(s => age >= s && age < s + 55);
        const after = Math.max(0, 1 - age / 600) * 0.15;
        for (let i = 0; i < n; i++) {
          const d = (this.xs[i] - bo.x) * bo.dir;
          if (d < 0 || d > bo.len) continue;
          const j = bo.jag[Math.min(139, Math.floor(d))];
          add(i, [235, 240, 255], on ? j : after * j);
        }
      }
      this.parts = this.parts.filter(p => now - p.t0 < 400);
      for (const p of this.parts) { const a = (now - p.t0) / 400; dot(p.x + p.dir * a * 40, [90, 140, 255], (1 - a) * 0.5, 0.6); }
    } else if (m === 'comets') {
      this.parts = this.parts.filter(p => now - p.t0 < p.life);
      for (const p of this.parts) {
        // Move, bouncing off the walls; keep a trail of recent positions.
        p.x += p.dir * p.v * dt;
        if (p.x < this.left) { p.x = 2 * this.left - p.x; p.dir = 1; }
        if (p.x > this.right) { p.x = 2 * this.right - p.x; p.dir = -1; }
        p.trail.unshift(p.x); if (p.trail.length > 18) p.trail.pop();
        const a = (now - p.t0) / p.life, c = hsv(p.hue, 1, 1);
        dot(p.x, [255, 255, 255], (1 - a) * 0.8, 0.8);
        p.trail.forEach((x, k) => dot(x, c, (1 - a) * Math.exp(-k / 5) * 0.8, 1));
      }
    }
    return this.pack(r, g, b);
  }

  // Color by pitch: the pixel at distance d shows what the music was d / speed seconds ago.
  drawWave(now, add) {
    const h = this.hist, V = 95;
    if (h.length < 2) return;
    const D = Math.ceil(this.reach), line = new Array(D + 2);
    let j = h.length - 1;
    for (let d = 0; d <= D + 1; d++) {
      const t = now - (d / V) * 1000;
      while (j > 0 && h[j][0] > t) j--;
      const a = h[j], z = h[Math.min(j + 1, h.length - 1)];
      const f = z[0] > a[0] ? Math.max(0, Math.min(1, (t - a[0]) / (z[0] - a[0]))) : 0;
      let dh = z[1] - a[1]; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
      line[d] = hsv((a[1] + dh * f + 360) % 360, 1, a[2] + (z[2] - a[2]) * f);
    }
    for (let i = 0; i < this.count; i++) {
      const ad = Math.abs(this.xs[i]);
      if (ad > D) continue;
      const k = Math.floor(ad), f = ad - k, c0 = line[k], c1 = line[k + 1];
      add(i, [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f], 1);
    }
  }

  // Spectrum bloom: band k fills slot k (bass at the center), a dark pixel between slots, peak markers.
  drawSpectrum(dt, add) {
    const D = Math.max(-this.left, this.right), slot = D / 16;
    for (let k = 0; k < 16; k++) this.peaks[k] = Math.max(this.bands[k], this.peaks[k] - dt * 0.35);
    for (let i = 0; i < this.count; i++) {
      const ad = Math.abs(this.xs[i]);
      if (ad > D) continue;
      const k = Math.min(15, Math.floor(ad / slot)), pos = ad - k * slot;
      if (pos < 1) continue; // the dark gap between bands
      const c = hsv(10 + k * 18, 1, 1), lvl = this.bands[k];
      // Each band's slot fills outward with its level; the rest of the slot glows faintly.
      add(i, c, pos / slot <= lvl ? 0.35 + 0.65 * lvl : 0.06 * lvl);
      const pk = 1 + this.peaks[k] * (slot - 1);
      if (Math.abs(pos - pk) < 0.8) add(i, [255, 255, 255], 0.8 * this.peaks[k]);
    }
  }

  pack(r, g, b) {
    const n = this.count, out = this.buf;
    out[0] = 0x41; out[1] = (this.seq = (this.seq + 1) & 15) || 1; out[2] = 0x0b; out[3] = 1;
    out.writeUInt32BE(0, 4); out.writeUInt16BE(n * 3, 8);
    for (let i = 0; i < n; i++) {
      let c = [r[i], g[i], b[i]].map(v => Math.round(Math.min(255, v)));
      if (c[0] + c[1] + c[2] > 0) c = calColor([...c, 0]).slice(0, 3); // hue-corrected for this strip
      for (let k = 0; k < 3; k++) out[10 + i * 3 + k] = Math.round(255 * (c[k] / 255) ** GAMMA);
    }
    return out;
  }

  get running() { return !!this.timer; }
  start(mode = this.mode) {
    if (mode !== this.mode) { this.mode = mode; this.reset(); }
    if (this.timer) return;
    this.lastT = Date.now();
    this.timer = setInterval(() => this.sock.send(this.render(Date.now()), this.port, this.host), 1000 / FPS);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.reset(); }
}
