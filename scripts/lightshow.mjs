// The laptop's DJ light: drawn here, frame by frame, and streamed to the controller over DDP (UDP 4048,
// ~60 frames a second), so it can do what WLED's built-in effects can't: crisp, sub-pixel pulses that
// fly from the machines' middle (between Cactus Canyon and Whirlwind) out to both walls.
//
//   kick drum   → a big pulse each way: bright head, long fading tail, color by the song's pitch
//   snare / hats → small, fast sparks each way
//   the music's loudness → a glow at the center
// Everything else stays dark, so the pulses stand out. The curb draws what's directly above it.
//
// music-sync.mjs feeds it the (speaker-delayed) analysis and decides when it runs: only while the
// host's music mode is DJ light and nothing else (a score flash, house lights, the reveal) is showing.
import dgram from 'node:dgram';
import { LIGHTS, beamOf, curbOffset } from '../web/src/lib/lights/config.js';
import { calColor } from '../web/src/lib/lights/colorCal.js';

const FPS = 60;
const GAMMA = 2.4; // WLED leaves streamed colors alone: do its gamma here (darker darks, more contrast)

const hsv = (h, s, v) => { // h 0–360, s/v 0–1 → [r, g, b] 0–255
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map(x => Math.round(x * 255));
};
// Low notes red/orange, mids green/teal, highs blue/violet.
const hueFor = hz => { const t = Math.max(0, Math.min(1, Math.log(Math.max(hz, 80) / 80) / Math.log(4000 / 80))); return 10 + t * 270; };

export class LightShow {
  constructor({ host, zones, port = 4048 }) {
    this.host = host; this.port = port;
    const { top, curb } = LIGHTS.runs;
    this.topLen = top.stop - top.start;
    this.count = curb.start + this.topLen; // the controller's 470 LEDs
    const z = zones.top.find(t => t.machineId === LIGHTS.musicCenterAfter) || zones.top[Math.floor(zones.top.length / 2)];
    this.origin = z.stop; // top-run pixel the pulses start from
    this.curbD = beamOf(LIGHTS).start - top.start + curbOffset(zones, LIGHTS); // curb pixel k sits under top pixel k + d
    // Distance from the origin for every LED (the curb uses the top pixel above it).
    this.xs = Float32Array.from({ length: this.count }, (_, i) => (i < curb.start ? i - top.start : i - curb.start + this.curbD) - this.origin);
    this.reach = Math.max(this.origin - top.start, top.stop - this.origin) + 8;
    this.parts = [];
    this.glow = 0; this.glowHue = 30;
    this.sock = dgram.createSocket('udp4');
    this.buf = Buffer.alloc(10 + this.count * 3);
    this.seq = 0; this.timer = null; this.last = 0;
  }

  // One analysis frame, already delayed to match the speakers: { vol 0–255, beat, hat, hz, strength }.
  feed(f) {
    const now = Date.now();
    this.glow = Math.max(this.glow * 0.85, (f.vol / 255) ** 1.6);
    this.glowHue = this.glowHue * 0.9 + hueFor(f.hz) * 0.1;
    if (f.beat) {
      const hue = hueFor(f.hz), amp = Math.min(1, 0.55 + 0.45 * (f.strength || 1));
      for (const dir of [-1, 1]) this.parts.push({ t0: now, dir, v: 150, hue, sat: 1, amp, w: 1.6, tail: 22 });
    }
    if (f.hat) for (const dir of [-1, 1]) this.parts.push({ t0: now, dir, v: 230, hue: (hueFor(f.hz) + 180) % 360, sat: 0.55, amp: 0.45, w: 0.9, tail: 6 });
    if (this.parts.length > 80) this.parts.splice(0, this.parts.length - 80);
  }

  render(now) {
    const n = this.count, r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
    const add = (i, c, k) => { r[i] += c[0] * k; g[i] += c[1] * k; b[i] += c[2] * k; };
    // Center glow: the music's loudness, a few pixels wide, in the running pitch color.
    const gc = hsv(this.glowHue, 0.9, 1);
    this.glow *= 0.97;
    for (let i = 0; i < n; i++) { const x = this.xs[i]; if (Math.abs(x) < 6) add(i, gc, this.glow * 0.7 * Math.exp(-(x * x) / 8)); }
    // Pulses: a gaussian head with an exponential tail back toward the center.
    this.parts = this.parts.filter(p => (now - p.t0) / 1000 * p.v < this.reach + p.tail * 3);
    for (const p of this.parts) {
      const head = p.dir * (now - p.t0) / 1000 * p.v;
      const c = hsv(p.hue, p.sat, 1);
      const fade = p.amp * Math.max(0.25, 1 - Math.abs(head) / (this.reach * 1.4)); // dims a little as it travels
      for (let i = 0; i < n; i++) {
        const behind = (head - this.xs[i]) * p.dir; // >0: behind the head (toward the center)
        if (behind < -4 * p.w || behind > p.tail * 4) continue;
        const head2 = Math.exp(-(behind * behind) / (2 * p.w * p.w));
        const k = behind < 0 ? head2 : Math.max(head2, 0.6 * Math.exp(-behind / p.tail));
        add(i, c, k * fade);
      }
    }
    // Pack: hue-corrected for this strip, gamma, 8-bit RGB.
    const out = this.buf;
    out[0] = 0x41; out[1] = (this.seq = (this.seq + 1) & 15) || 1; out[2] = 0x0b; out[3] = 1;
    out.writeUInt32BE(0, 4); out.writeUInt16BE(n * 3, 8);
    for (let i = 0; i < n; i++) {
      let c = [r[i], g[i], b[i]].map(v => Math.round(Math.min(255, v)));
      if (c[0] + c[1] + c[2] > 0) c = calColor([...c, 0]).slice(0, 3);
      for (let k = 0; k < 3; k++) out[10 + i * 3 + k] = Math.round(255 * (c[k] / 255) ** GAMMA);
    }
    return out;
  }

  get running() { return !!this.timer; }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.sock.send(this.render(Date.now()), this.port, this.host), 1000 / FPS);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.parts = []; }
}
