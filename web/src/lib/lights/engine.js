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
import { LIGHTS, defaultZones } from './config.js';

const MERGE_MS = 50;
const SEG_GAP_MS = 1000;

export const DUR = { score: 3000, champion: 5000, leader: 4000, open: 4000 };

export class LightsEngine {
  constructor({ send, cfg = LIGHTS, zones = null, timeScale = 1, log = () => {} } = {}) {
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
  }

  // --- helpers ---------------------------------------------------------------------------------
  fx(name) { return this.cfg.effects[name] ?? 0; }
  ms(n) { return Math.round(n * this.timeScale); }
  later(fn, n) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, this.ms(n));
    this.timers.add(t);
    return t;
  }
  machineIndex(machineId) { return this.cfg.machineOrder.indexOf(Number(machineId)); }
  machineSegs(machineId) {
    const i = this.machineIndex(machineId);
    if (i < 0) return null;
    return { top: this.cfg.runs.top.firstMachineSeg + i, curb: this.cfg.runs.curb.firstMachineSeg + i };
  }
  allMachineSegs() {
    return this.cfg.machineOrder.flatMap((_, i) => [this.cfg.runs.top.firstMachineSeg + i, this.cfg.runs.curb.firstMachineSeg + i]);
  }
  baseSegs() { return [this.cfg.runs.top.baseSeg, this.cfg.runs.curb.baseSeg]; }
  isBase(id) { return this.baseSegs().includes(id); }

  restState(id) {
    if (!this.isBase(id)) return { id, on: false };
    const b = this.cfg.partyBase;
    return { id, on: true, fx: this.fx(b.fx), sx: b.sx, ix: b.ix, bri: b.bri, col: b.col };
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
    if (this.pending.size) payload.seg = [...this.pending.values()];
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
  effect(id, state, prio, durMs) {
    const st = this.seg(id);
    if (st.prio > prio) return false;
    const wasSame = st.prio === prio && st.prio > 0;
    if (st.timer) { clearTimeout(st.timer); this.timers.delete(st.timer); st.timer = null; }
    st.prio = prio;
    const seg = { id, on: true, ...state };
    // Throttle repeat low-priority effects on the same segment: hold the latest, send it when allowed.
    const since = Date.now() - st.lastSent;
    if (wasSame && prio < 4 && since < SEG_GAP_MS) {
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
      this.queue(seg, { immediate: prio > st.prioAtLastSend });
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
    this.queue(this.restState(id));
  }

  // --- layout -----------------------------------------------------------------------------------
  // Push segment bounds so the controller always matches the saved zones. Machine segments start off.
  applyLayout(zones = this.zones) {
    this.zones = zones;
    const { top, curb } = this.cfg.runs;
    this.queue({ id: top.baseSeg, start: top.start, stop: top.stop });
    this.queue({ id: curb.baseSeg, start: curb.start, stop: curb.stop });
    this.cfg.machineOrder.forEach((mid, i) => {
      const t = zones.top.find(z => z.machineId === mid) || zones.top[i];
      const c = zones.curb.find(z => z.machineId === mid) || zones.curb[i];
      if (t) this.queue({ id: top.firstMachineSeg + i, start: t.start, stop: t.stop, on: false });
      if (c) this.queue({ id: curb.firstMachineSeg + i, start: c.start, stop: c.stop, on: false });
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
  start() { // page load / party open: clean slate, zones pushed, party base on
    this.clearAll();
    this.applyLayout();
    for (const id of this.allMachineSegs()) this.queue({ id, on: false });
    for (const id of this.baseSegs()) this.queue(this.restState(id));
    this.queueExtra({ on: true });
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
    this.house = false; this.revealing = false;
    for (const id of this.allMachineSegs()) this.queue({ id, on: false });
    this.queueExtra({ ps: this.cfg.ambientPreset });
    this.flush();
  }

  score(machineId, color) {
    if (this.blocked(1)) return;
    const s = this.machineSegs(machineId);
    if (!s) return;
    const state = { fx: this.fx('Breathe'), sx: 200, ix: 128, bri: 255, col: [color, [0, 0, 0, 0]] };
    this.effect(s.curb, state, 1, DUR.score);
    if (this.cfg.scoreAlsoOnTop) this.effect(s.top, state, 1, DUR.score);
  }

  champion(machineId, color) {
    if (this.blocked(3)) return;
    const s = this.machineSegs(machineId);
    if (!s) return;
    this.effect(s.top, { fx: this.fx('Chase Rainbow'), sx: 200, ix: 128, bri: 255, col: [color] }, 3, DUR.champion);
    this.effect(s.curb, { fx: this.fx('Solid'), bri: 255, col: [color] }, 3, DUR.champion);
  }

  leader(color) {
    if (this.blocked(2)) return;
    this.effect(this.cfg.runs.top.baseSeg, { fx: this.fx('Solid'), bri: 255, col: [color] }, 2, DUR.leader);
  }

  blocked(prio) { return (this.revealing || this.house) && prio < 4; }

  // House lights: both runs full natural white, held until turned off again.
  setHouse(on) {
    this.house = !!on;
    if (on) {
      this.clearAll();
      for (const id of this.allMachineSegs()) this.queue({ id, on: false });
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
  revealCue(cue) {
    this.revealing = true;
    this.house = false;
    this.clearAll();
    const [top, curb] = this.baseSegs();
    for (const id of this.allMachineSegs()) this.queue({ id, on: false });
    const c = cue.color || [255, 179, 0, 0];
    if (cue.final) {
      // Dim, slow build, burst in the winner's color, then three white house-light flashes (≤ 3/s).
      const steps = [
        [0, { fx: this.fx('Solid'), bri: 25, col: [c] }],
        [900, { fx: this.fx('Wipe'), sx: 60, bri: 140, col: [c, [0, 0, 0, 0]] }],
        [2700, { fx: this.fx('Solid'), bri: 255, col: [c] }],
        [3700, { fx: this.fx('Solid'), bri: 255, col: [this.cfg.houseWhite] }],
        [3950, { fx: this.fx('Solid'), bri: 255, col: [c] }],
        [4300, { fx: this.fx('Solid'), bri: 255, col: [this.cfg.houseWhite] }],
        [4550, { fx: this.fx('Solid'), bri: 255, col: [c] }],
        [4900, { fx: this.fx('Solid'), bri: 255, col: [this.cfg.houseWhite] }],
        [5150, { fx: this.fx('Chase Rainbow'), sx: 180, bri: 255, col: [c] }],
      ];
      for (const [at, st] of steps) {
        this.later(() => {
          this.effect(top, st, 4, 0);
          this.effect(curb, st, 4, 0);
          this.flush();
        }, at);
      }
    } else {
      this.effect(top, { fx: this.fx('Breathe'), sx: 120, bri: 255, col: [c, [0, 0, 0, 0]] }, 4, 0);
      this.effect(curb, { fx: this.fx('Solid'), bri: 200, col: [c] }, 4, 0);
      const s = cue.machineId ? this.machineSegs(cue.machineId) : null;
      if (s) {
        this.effect(s.top, { fx: this.fx('Chase Rainbow'), sx: 200, bri: 255, col: [c] }, 4, 0);
        this.effect(s.curb, { fx: this.fx('Solid'), bri: 255, col: [c] }, 4, 0);
      }
      this.flush();
    }
  }

  revealEnd() {
    this.revealing = false;
    this.clearAll();
    for (const id of this.allMachineSegs()) this.queue({ id, on: false });
    for (const id of this.baseSegs()) this.queue(this.restState(id));
    this.flush();
  }

  destroy() { this.clearAll(); if (this.flushTimer) clearTimeout(this.flushTimer); }
}
