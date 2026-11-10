// Lights engine: turns party events into WLED JSON state commands.
// It never talks to the network itself: `send(payload)` does (MQTT, the simulator, or a test spy).
//
// Rules (from the lighting plan):
// - Every effect has a server-side restore timer per segment; a new effect on a segment replaces the
//   old one and resets its timer. Machine segments restore to off, base segments to the party base.
// - Priorities: a higher one preempts, an equal one replaces, a lower one is dropped while a higher
//   effect runs (so scores do nothing during the reveal). 4 = reveal/house lights, 3 = machine
//   champion, 2 = new leader / party opened, 1 = score.
// - Changes within ~50 ms merge into one message, and a segment gets at most one new low-priority
//   command per second (5 scores in 2 s → at most 3 commands for that segment).
// - Nothing flashes faster than 3 times a second.
import { LIGHTS, defaultZones, beamOf, curbOffset, parkOf } from './config.js';

const MERGE_MS = 50;
const KEEP_OFF_MS = 5000;
const SEG_GAP_MS = 1000;

export const DUR = { score: 3000, champion: 5000, leader: 4000, open: 4000, ranked: 3500, shame: 4500 };

export class LightsEngine {
  constructor({ send, cfg = LIGHTS, zones = null, timeScale = 1, music = null, log = () => {} } = {}) {
    this.send = send;
    this.cfg = cfg;
    this.zones = zones || defaultZones(cfg);
    this.timeScale = timeScale;
    this.log = log;
    this.segs = new Map(); // id → { prio, timer, lastSent, held }
    this.pending = new Map(); // id → seg object waiting to go out
    this.extra = {}; // top-level fields for the next message (ps, bri)
    this.flushTimer = null;
    this.timers = new Set();
    this.house = false;
    this.revealing = false;
    this.music = music && cfg.music[music] ? music : null; // music mode: name of a sound-reactive effect
    this.cycleIdx = 0; // which ambient effect is up (rotates every cfg.ambientMinutes)
    this.cycleTimer = null;
    this.bounds = {}; // machine segment id → its real pixels { start, stop }
    this.needsLayout = true; // until zones are pushed, the first effect pushes them (host / simulator engines)
  }

  // --- helpers ---------------------------------------------------------------------------------
  fx(name) { return this.cfg.effects[name] ?? 0; }
  ms(n) { return Math.round(n * this.timeScale); }
  later(fn, n) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, this.ms(n));
    this.timers.add(t);
    return t;
  }
  theme(machineId, fallback) { return this.cfg.machineThemes?.[Number(machineId)]?.colors || [fallback, fallback, fallback]; }
  // A mirrored chase that alternates the machine's three colors.
  themeChase(machineId, fallback, sx = 200) { return { fx: this.fx('Chase'), sx, ix: 128, bri: 255, col: this.theme(machineId, fallback) }; }
  machineIndex(machineId) { return this.cfg.machineOrder.indexOf(Number(machineId)); }
  machineSegs(machineId) {
    const i = this.machineIndex(machineId);
    if (i < 0) return null;
    return { top: this.cfg.runs.top.firstMachineSeg + i, curb: this.cfg.runs.curb.firstMachineSeg + i };
  }
  allMachineSegs() {
    return this.cfg.machineOrder.flatMap((_, i) => [this.cfg.runs.top.firstMachineSeg + i, this.cfg.runs.curb.firstMachineSeg + i]);
  }
  // The ambient layers: whole top run, beam band (over the machines), curb. Band and curb always get
  // the same effect in the same message, so they run in lockstep, stacked.
  baseSegs() { return [this.cfg.runs.top.baseSeg, this.cfg.runs.top.bandSeg, this.cfg.runs.curb.baseSeg]; }
  isBase(id) { return this.baseSegs().includes(id); }
  // An idle machine zone: switched off AND parked on an invisible pixel (WLED paints off segments black).
  offState(id) { return { id, ...parkOf(id, this.cfg), on: false }; }

  restState(id) {
    if (!this.isBase(id)) return this.offState(id);
    if (this.music) {
      const m = this.cfg.music[this.music];
      return { id, on: true, fx: this.fx(this.music), sx: m.sx, ix: m.ix, pal: 4, bri: 255, col: this.cfg.partyBase.col };
    }
    const list = this.cfg.ambientCycle;
    if (list?.length) {
      const a = list[this.cycleIdx % list.length];
      const col = a.col ? a.col.map(n => this.cfg.coolColors[n]) : this.cfg.partyBase.col;
      return { id, on: true, fx: this.fx(a.fx), sx: a.sx ?? 128, ix: a.ix ?? 128, pal: a.pal ?? 0, bri: this.cfg.ambientBri ?? 170, col };
    }
    const b = this.cfg.partyBase;
    return { id, on: true, fx: this.fx(b.fx), sx: b.sx, ix: b.ix, pal: b.pal ?? 0, bri: b.bri, col: b.col };
  }

  // Rotate the ambient effect. Layers at rest switch now (together, so they stay in sync); busy ones
  // pick it up when their effect ends.
  startCycle() {
    this.stopCycle();
    const mins = this.cfg.ambientMinutes;
    if (!mins || !(this.cfg.ambientCycle?.length > 1)) return;
    this.cycleTimer = setInterval(() => this.nextAmbient(), this.ms(mins * 60000));
  }
  nextAmbient() {
    const n = this.cfg.ambientCycle?.length || 1;
    this.cycleIdx = (this.cycleIdx + 1) % n;
    if (this.music || this.house || this.revealing) return;
    const idle = this.baseSegs().filter(id => this.seg(id).prio === 0);
    for (const id of idle) this.queue(this.restState(id));
    this.flush();
  }
  setAmbient(i) { // jump straight to one ambient effect (simulator / host preview)
    const n = this.cfg.ambientCycle?.length || 1;
    this.cycleIdx = ((i % n) + n) % n - 1;
    this.nextAmbient();
  }
  ambientName() { return this.music ? this.cfg.music[this.music].label : (this.cfg.ambientCycle?.[this.cycleIdx]?.fx || this.cfg.partyBase.fx); }
  stopCycle() { if (this.cycleTimer) clearInterval(this.cycleTimer); this.cycleTimer = null; }

  // Music mode on (an effect name from cfg.music) or off (null). Layers at rest switch now; layers
  // busy with an effect switch when it ends.
  setMusic(name) {
    this.music = name && this.cfg.music[name] ? name : null;
    if (this.house || this.revealing) return;
    for (const id of this.baseSegs()) if (this.seg(id).prio === 0) this.queue(this.restState(id));
    this.flush();
  }

  // Queue a segment change; merged with anything else queued in the next 50 ms.
  queue(seg, { immediate = false } = {}) {
    this.pending.set(seg.id, { ...(this.pending.get(seg.id) || {}), ...seg });
    if (immediate) { this.flush(); return; }
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), MERGE_MS);
  }
  queueExtra(fields) {
    Object.assign(this.extra, fields);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), MERGE_MS);
  }
  flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (!this.pending.size && !Object.keys(this.extra).length) return;
    const payload = { ...this.extra };
    // Ascending ids: WLED appends a missing segment at the next free slot, so 0, 1, 2… must arrive in order.
    if (this.pending.size) payload.seg = [...this.pending.values()].sort((a, b) => a.id - b.id);
    this.pending.clear();
    this.extra = {};
    const now = Date.now();
    for (const s of payload.seg || []) { const st = this.seg(s.id); st.lastSent = now; }
    try { this.send(payload); } catch (e) { this.log('lights send failed', e); }
  }
  seg(id) {
    if (!this.segs.has(id)) this.segs.set(id, { prio: 0, timer: null, lastSent: 0, held: null });
    return this.segs.get(id);
  }

  // Start an effect on one segment. Returns false if a higher-priority effect is running.
  effect(id, state, prio, durMs, { force = false } = {}) {
    if (this.needsLayout) this.applyLayout();
    const st = this.seg(id);
    if (st.prio > prio) return false;
    const wasSame = st.prio === prio && st.prio > 0;
    if (st.timer) { clearTimeout(st.timer); this.timers.delete(st.timer); st.timer = null; }
    st.prio = prio;
    // Machine zones are always symmetric: mirrored around the machine's center, so nothing ever
    // scrolls one way across a machine (rev + mi = moving out from the center).
    const seg = this.isBase(id) ? { id, on: true, ...state } : { id, ...this.bounds[id], on: true, mi: true, rev: true, ...state };
    // Throttle repeat low-priority effects on the same segment: hold the latest, send it when allowed.
    const since = Date.now() - st.lastSent;
    if (!force && wasSame && prio < 4 && since < SEG_GAP_MS) {
      st.held = seg;
      if (!st.heldTimer) {
        st.heldTimer = setTimeout(() => {
          st.heldTimer = null;
          if (st.held && st.prio === prio) this.queue(st.held);
          st.held = null;
        }, SEG_GAP_MS - since);
      }
    } else {
      st.held = null;
      this.queue(seg); // always merged (50 ms), so stacked layers change together in one message
    }
    st.prioAtLastSend = prio;
    if (durMs) st.timer = this.later(() => this.restore(id), durMs);
    return true;
  }

  restore(id) {
    const st = this.seg(id);
    if (st.timer) { clearTimeout(st.timer); this.timers.delete(st.timer); }
    if (st.heldTimer) { clearTimeout(st.heldTimer); st.heldTimer = null; }
    st.timer = null; st.held = null; st.prio = 0; st.prioAtLastSend = 0;
    if (this.closed) {
      // After the party closes the room belongs to your preset. Any message to WLED stops a running
      // playlist, so once this effect is over, start the preset again.
      if (!this.isBase(id)) this.queue(this.offState(id));
      if ([...this.segs.values()].every(x => x.prio === 0)) this.queueExtra({ ps: this.cfg.ambientPreset });
      return;
    }
    this.queue(this.restState(id));
  }

  // --- layout -----------------------------------------------------------------------------------
  // Push segment bounds so the controller always matches the saved zones. Machine segments start off.
  applyLayout(zones = this.zones) {
    this.zones = zones;
    const { top, curb } = this.cfg.runs;
    // The top run is one continuous pattern from the left wall over the beam to the right wall: segment 1
    // has exactly the same bounds as segment 0, so no pattern restarts at the corners.
    // The curb is the top run's length too (pixels past the real strip don't exist), shifted by `of`,
    // so curb pixel k shows what the top pixel directly above it shows.
    const len = top.stop - top.start;
    const d = beamOf(this.cfg).start - top.start + curbOffset(zones, this.cfg); // curb pixel k = top pixel k + d
    const of = (((this.cfg.wledOffsetAdds === false ? d : -d) % len) + len) % len;
    this.needsLayout = false;
    this.queue({ id: top.baseSeg, start: top.start, stop: top.stop });
    this.queue({ id: top.bandSeg, start: top.start, stop: top.stop });
    this.queue({ id: curb.baseSeg, start: curb.start, stop: curb.start + len, of });
    this.cfg.machineOrder.forEach((mid, i) => {
      const t = zones.top.find(z => z.machineId === mid) || zones.top[i];
      const c = zones.curb.find(z => z.machineId === mid) || zones.curb[i];
      // Remember each zone's real pixels (effects send them); idle zones stay parked, busy ones keep going.
      for (const [id, z] of [[top.firstMachineSeg + i, t], [curb.firstMachineSeg + i, c]]) {
        if (!z) continue;
        this.bounds[id] = { start: z.start, stop: z.stop };
        if (this.seg(id).prio === 0) this.queue(this.offState(id));
      }
    });
  }

  clearAll() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const st of this.segs.values()) {
      if (st.heldTimer) clearTimeout(st.heldTimer);
      st.prio = 0; st.timer = null; st.held = null; st.heldTimer = null; st.prioAtLastSend = 0;
    }
  }

  // --- party events -----------------------------------------------------------------------------
  // The broker can drop a message now and then. Every few seconds, re-send "off" to machine zones that
  // are at rest, so a lost "off" can't leave a machine lit for the rest of the night.
  startKeepOff() {
    this.stopKeepOff();
    let ticks = 0;
    this.keepOffTimer = setInterval(() => {
      // Once a minute, push the whole layout again (a quick reboot may never announce "offline");
      // zones that are busy are left alone, and unchanged bounds don't restart WLED's effects.
      if (++ticks % 12 === 0) { this.applyLayout(); return; }
      const idle = this.allMachineSegs().filter(id => this.seg(id).prio === 0 && !this.pending.has(id));
      if (!idle.length) return;
      for (const id of idle) this.queue(this.offState(id));
    }, KEEP_OFF_MS);
  }
  stopKeepOff() { if (this.keepOffTimer) clearInterval(this.keepOffTimer); this.keepOffTimer = null; }

  start() { // page load / party open: clean slate, zones pushed, party base on
    this.closed = false;
    this.clearAll();
    this.startCycle();
    this.startKeepOff();
    this.applyLayout();
    for (const id of this.allMachineSegs()) this.queue(this.offState(id));
    for (const id of this.baseSegs()) this.queue(this.restState(id));
    this.queueExtra({ on: true });
    this.flush();
  }

  // The controller came back (power cut, reboot): it has forgotten the app's segments. Push the
  // zones again and put the current look back, without interrupting anything the app is doing.
  resync() {
    if (this.closed) {
      // Your preset is playing; leave it alone. (During the reveal the zones still matter: re-lay them
      // before the next cue.)
      this.needsLayout = true;
      if (!this.revealing) return;
    }
    this.applyLayout();
    if (this.house) for (const id of this.baseSegs()) this.queue({ id, on: true, fx: this.fx('Solid'), bri: 255, col: [this.cfg.houseWhite] });
    else if (!this.revealing) for (const id of this.baseSegs()) if (this.seg(id).prio === 0) this.queue(this.restState(id));
    this.flush();
  }

  partyOpen() {
    this.start();
    const sweep = { fx: this.fx('Wipe'), sx: 200, ix: 128, bri: 255, col: [[0, 229, 255, 0], [157, 77, 255, 0]] };
    for (const id of this.baseSegs()) this.effect(id, sweep, 2, DUR.open);
  }

  // Party closed or the page is going away: machine zones off, back to Matt's ambient preset.
  stop() {
    this.clearAll();
    this.stopCycle();
    this.house = false; this.revealing = false;
    for (const id of this.allMachineSegs()) this.queue(this.offState(id));
    this.queueExtra({ ps: this.cfg.ambientPreset });
    this.flush();
    this.stopKeepOff();
    this.closed = true; // your preset plays; the app only steps in for a moment (see restore)
    this.needsLayout = true; // the preset may change segments; push the zones again before the next effect
  }

  score(machineId, color) {
    if (this.blocked(1)) return;
    const s = this.machineSegs(machineId);
    if (!s) return;
    // Breathes between the player's color and the machine's main color.
    const state = { fx: this.fx('Breathe'), sx: 200, ix: 128, bri: 255, col: [color, this.theme(machineId, [0, 0, 0, 0])[0]] };
    this.effect(s.curb, state, 1, DUR.score);
    if (this.cfg.scoreAlsoOnTop) this.effect(s.top, state, 1, DUR.score);
  }

  // Run steps [[atMs, state], …] on several segments together; the last step gets the restore timer.
  sequence(ids, steps, prio, durMs) {
    steps.forEach(([at, state], i) => {
      const last = i === steps.length - 1;
      const go = () => {
        for (const id of ids) this.effect(id, state, prio, last ? durMs : 0, { force: true });
      };
      if (at === 0) go(); else this.later(() => { if (ids.every(id => this.seg(id).prio <= prio)) go(); }, at);
    });
  }

  // Two quick full-white flashes (white chip only) then `then`: 0 on, 200 off, 400 on, 650 final (2.5/s).
  whiteFlashSteps(then, times = 2) {
    const W = { fx: this.fx('Solid'), bri: 255, col: [this.cfg.houseWhite] };
    const off = { fx: this.fx('Solid'), bri: 255, col: [[0, 0, 0, 0]] };
    const steps = [[0, W]];
    for (let k = 1; k < times; k++) steps.push([400 * k - 200, off], [400 * k, W]);
    steps.push([400 * (times - 1) + 250, then]);
    return steps;
  }

  champion(machineId, color) { // a new high score: white flashes, then the machine's colors chase out from its center
    if (this.blocked(3)) return;
    const s = this.machineSegs(machineId);
    if (!s) return;
    const chase = this.themeChase(machineId, color); // top and curb together: one tall column of light
    if (this.cfg.whiteFlash?.champion) this.sequence([s.top, s.curb], this.whiteFlashSteps(chase), 3, DUR.champion);
    else for (const id of [s.top, s.curb]) this.effect(id, chase, 3, DUR.champion);
  }

  // A player unlocks their overall ranking: the room breathes once in their color.
  ranked(color) {
    if (this.blocked(2)) return;
    const glow = { fx: this.fx('Breathe'), sx: 150, ix: 128, bri: 255, col: [color, [0, 0, 0, 0]] };
    for (const id of this.baseSegs()) this.effect(id, glow, 2, DUR.ranked);
  }

  // A games-played milestone (e.g. 50 games tonight): the room celebrates, top and curb bouncing
  // in gold, then back to ambient.
  milestone() {
    this.pingPong(this.cfg.milestoneGold, { times: 6, prio: 2 });
  }

  // Someone new hits the bottom of the Wall of Shame: a "sad trombone" — the room sags to a dim,
  // slow red breath for a few seconds, then recovers.
  shame() {
    if (this.blocked(2)) return;
    const droop = { fx: this.fx('Breathe'), sx: 40, ix: 128, bri: 110, col: [[150, 0, 0, 0], [0, 0, 0, 0]] };
    for (const id of this.baseSegs()) this.effect(id, droop, 2, DUR.shame);
  }

  leader(color) { // a new #1: white bounces top ↔ bottom, then the whole room washes in their color
    if (this.blocked(2)) return;
    const wash = { fx: this.fx('Solid'), bri: 255, col: [color] };
    if (this.cfg.whiteFlash?.leader) this.pingPong(this.cfg.houseWhite, { then: wash, prio: 2, durMs: DUR.leader });
    else for (const id of this.baseSegs()) this.effect(id, wash, 2, DUR.leader);
  }

  // The top run and the curb take turns: top lit / curb dark, then swapped, `times` bounces, then
  // `then` on both (or back to ambient). Each side lights every 600 ms, under 3 flashes a second.
  // This is why the curb is its own segment: it mirrors the beam only when we send it the same thing.
  pingPong(color, { times = 4, stepMs = 300, then = null, prio = 2, durMs = DUR.leader } = {}) {
    if (this.blocked(prio)) return;
    const on = { fx: this.fx('Solid'), bri: 255, col: [color] };
    const off = { fx: this.fx('Solid'), bri: 255, col: [[0, 0, 0, 0]] };
    const { top, curb } = this.cfg.runs;
    const end = then || off;
    const topSteps = [], curbSteps = [];
    for (let k = 0; k < times; k++) {
      topSteps.push([k * stepMs, k % 2 ? off : on]);
      curbSteps.push([k * stepMs, k % 2 ? on : off]);
    }
    topSteps.push([times * stepMs, end]); curbSteps.push([times * stepMs, end]);
    this.sequence([top.baseSeg, top.bandSeg], topSteps, prio, then ? durMs : 1);
    this.sequence([curb.baseSeg], curbSteps, prio, then ? durMs : 1);
  }

  blocked(prio) { return (this.revealing || this.house) && prio < 4; }

  // House lights: both runs full natural white, held until turned off again.
  setHouse(on) {
    this.house = !!on;
    if (on) {
      this.clearAll();
      for (const id of this.allMachineSegs()) this.queue(this.offState(id));
      for (const id of this.baseSegs()) this.effect(id, { fx: this.fx('Solid'), bri: 255, col: [this.cfg.houseWhite] }, 4, 0);
      this.flush();
    } else {
      for (const id of this.baseSegs()) this.restore(id);
      this.flush();
    }
  }

  ambient() { this.stop(); }
  brightness(bri) { this.queueExtra({ bri: Math.max(1, Math.min(255, Math.round(bri))) }); }

  test(machineId, color) { // host Test button: a score pulse that ignores house/reveal blocks
    const s = this.machineSegs(machineId);
    if (!s) return;
    this.effect(s.curb, { fx: this.fx('Breathe'), sx: 200, bri: 255, col: [color, [0, 0, 0, 0]] }, 1, DUR.score);
  }

  // --- winner reveal ------------------------------------------------------------------------------
  // One cue per reveal slide, sent by the TV as each slide appears (so lights and TV share a timeline).
  // cue: { color: [r,g,b,w], machineId?: id, final?: bool }
  // The reveal's 3-2-1 before each prize: the room goes dark and pulses once per count, brighter each
  // time (one pulse a second, well under 3 flashes a second), in the prize's color.
  revealTick(n, color) {
    this.revealing = true;
    this.house = false;
    this.clearAll();
    for (const id of this.allMachineSegs()) this.queue(this.offState(id));
    const c = color || [255, 179, 0, 0];
    const bri = { 3: 70, 2: 150, 1: 255 }[n] ?? 120;
    for (const id of this.baseSegs()) this.effect(id, { fx: this.fx('Solid'), bri, col: [c] }, 4, 0, { force: true });
    this.flush();
    this.later(() => {
      for (const id of this.baseSegs()) this.effect(id, { fx: this.fx('Solid'), bri: 12, col: [c] }, 4, 0, { force: true });
      this.flush();
    }, 380);
  }

  revealCue(cue) {
    this.revealing = true;
    this.house = false;
    this.clearAll();
    const [top, band, curb] = this.baseSegs();
    for (const id of this.allMachineSegs()) this.queue(this.offState(id));
    const c = cue.color || [255, 179, 0, 0];
    if (cue.final) {
      // Right after the countdown: burst in the winner's color, three white house-light flashes
      // (600 ms apart, under 3 a second), then a celebration chase that holds until the next prize.
      const steps = [
        [0, { fx: this.fx('Solid'), bri: 255, col: [c] }],
        [600, { fx: this.fx('Solid'), bri: 255, col: [this.cfg.houseWhite] }],
        [850, { fx: this.fx('Solid'), bri: 255, col: [c] }],
        [1200, { fx: this.fx('Solid'), bri: 255, col: [this.cfg.houseWhite] }],
        [1450, { fx: this.fx('Solid'), bri: 255, col: [c] }],
        [1800, { fx: this.fx('Solid'), bri: 255, col: [this.cfg.houseWhite] }],
        [2050, { fx: this.fx('Chase Rainbow'), sx: 180, bri: 255, col: [c] }],
      ];
      for (const [at, st] of steps) {
        this.later(() => {
          for (const id of [top, band, curb]) this.effect(id, st, 4, 0);
          this.flush();
        }, at);
      }
    } else {
      const glow = { fx: this.fx('Breathe'), sx: 120, bri: 255, col: [c, [0, 0, 0, 0]] };
      for (const id of [top, band, curb]) this.effect(id, glow, 4, 0);
      const s = cue.machineId ? this.machineSegs(cue.machineId) : null;
      if (s) {
        for (const id of [s.top, s.curb]) this.effect(id, this.themeChase(cue.machineId, c), 4, 0);
      }
      this.flush();
    }
  }

  revealEnd() {
    this.revealing = false;
    this.clearAll();
    for (const id of this.allMachineSegs()) this.queue(this.offState(id));
    for (const id of this.baseSegs()) this.queue(this.restState(id));
    this.flush();
  }

  // Shutting down: anything mid-effect goes back to rest first (never left frozen on a flash frame).
  destroy() {
    const busy = [...this.segs.entries()].filter(([, st]) => st.prio > 0).map(([id]) => id);
    this.clearAll(); this.stopCycle(); this.stopKeepOff();
    for (const id of busy) this.queue(this.restState(id));
    this.flush();
  }
}
