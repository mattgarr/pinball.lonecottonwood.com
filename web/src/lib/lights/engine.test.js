import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LightsEngine } from './engine.js';
import { LIGHTS } from './config.js';

const MAG = [255, 0, 170, 0];
const DND_ID = 6;
const CYAN = [0, 229, 255, 0];
// Machine segments by physical position: Whirlwind is 3rd from the left → top 4, curb 11; Fathom → top 2, curb 9.
const WHIRLWIND = 3, FATHOM = 2;

let sent, e;
const segsFor = id => sent.flatMap(p => (p.seg || []).filter(s => s.id === id));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T20:00:00Z'));
  sent = [];
  e = new LightsEngine({ send: p => sent.push(JSON.parse(JSON.stringify(p))) });
});
afterEach(() => { e.destroy(); vi.useRealTimers(); });

describe('lights engine', () => {
  it('start pushes zones, turns machine segments off and applies the party base', () => {
    e.start();
    expect(sent).toHaveLength(1);
    const segs = sent[0].seg;
    for (let id = 2; id <= 7; id++) expect(segs.find(s => s.id === id).on).toBe(false);
    for (let id = 9; id <= 14; id++) expect(segs.find(s => s.id === id).on).toBe(false);
    for (const id of [0, 1, 8]) expect(segs.find(s => s.id === id).fx).toBe(LIGHTS.effects.Colorwaves);
    expect(segs.find(s => s.id === 11).start).toBeGreaterThanOrEqual(235); // curb zones on the curb run
  });

  it('a score pulses that machine\'s curb zone within 1 s and restores it within 3.5 s', () => {
    e.score(WHIRLWIND, MAG);
    vi.advanceTimersByTime(100);
    const on = segsFor(11);
    expect(on[0]).toMatchObject({ id: 11, on: true, fx: LIGHTS.effects.Breathe, col: [MAG, LIGHTS.machineThemes[WHIRLWIND].colors[0]] });
    vi.advanceTimersByTime(3300);
    expect(segsFor(11).at(-1)).toMatchObject({ id: 11, on: false });
    expect(segsFor(11).at(-1).start).toBeGreaterThanOrEqual(320); // parked on an invisible pixel
  });

  it('two machines scoring within 1 s both pulse and both restore', () => {
    e.score(WHIRLWIND, MAG);
    vi.advanceTimersByTime(300);
    e.score(FATHOM, CYAN);
    vi.advanceTimersByTime(4000);
    expect(segsFor(11).filter(s => s.on).length).toBe(1);
    expect(segsFor(9).filter(s => s.on).length).toBe(1);
    expect(segsFor(11).at(-1).on).toBe(false);
    expect(segsFor(9).at(-1).on).toBe(false);
  });

  it('five scores in 2 s on one machine send at most three commands for that segment', () => {
    for (let i = 0; i < 5; i++) { e.score(WHIRLWIND, i % 2 ? MAG : CYAN); vi.advanceTimersByTime(400); }
    const pulses = segsFor(11).filter(s => s.on);
    expect(pulses.length).toBeLessThanOrEqual(3);
    vi.advanceTimersByTime(4000);
    expect(segsFor(11).at(-1).on).toBe(false); // still restores
  });

  it('nearby changes merge into one message', () => {
    e.score(WHIRLWIND, MAG);
    e.score(FATHOM, CYAN);
    vi.advanceTimersByTime(60);
    expect(sent).toHaveLength(1);
    expect(sent[0].seg.map(s => s.id).sort((a, b) => a - b)).toEqual([2, 4, 9, 11]) // top + curb zones of both machines, in one message;
  });

  it('a champion preempts a score; a score during a champion effect is dropped', () => {
    e.score(WHIRLWIND, MAG);
    vi.advanceTimersByTime(100);
    e.champion(WHIRLWIND, CYAN);
    vi.advanceTimersByTime(60);
    expect(segsFor(4).at(-1)).toMatchObject({ on: true, col: [[0, 0, 0, 255]] }); // white flash first
    vi.advanceTimersByTime(700);
    expect(segsFor(4).at(-1)).toMatchObject({ on: true, fx: LIGHTS.effects.Chase, col: LIGHTS.machineThemes[WHIRLWIND].colors });
    const n = segsFor(11).length;
    e.score(WHIRLWIND, MAG);
    vi.advanceTimersByTime(200);
    expect(segsFor(11).length).toBe(n);
    vi.advanceTimersByTime(5000);
    expect(segsFor(4).at(-1)).toMatchObject({ id: 4, on: false });
  });

  it('nothing else fires during the reveal', () => {
    e.revealCue({ color: CYAN, final: false });
    const before = sent.length;
    e.score(WHIRLWIND, MAG); e.champion(FATHOM, MAG); e.leader(MAG);
    vi.advanceTimersByTime(6000);
    expect(sent.length).toBe(before);
  });

  it('the final reveal flashes white no faster than 3 times a second', () => {
    e.revealCue({ color: MAG, final: true });
    vi.advanceTimersByTime(8000);
    const times = [];
    let t = 0;
    // re-run with timestamps
    e.destroy(); sent = [];
    e = new LightsEngine({ send: p => sent.push({ t: Date.now(), p }) });
    const start = Date.now();
    e.revealCue({ color: MAG, final: true });
    vi.advanceTimersByTime(8000);
    for (const { t: at, p } of sent) {
      const s = (p.seg || []).find(x => x.id === 0);
      if (s?.col?.[0]?.[3] === 255) times.push(at - start);
    }
    expect(times.length).toBe(3);
    for (let i = 1; i < times.length; i++) { t = times[i] - times[i - 1]; expect(t).toBeGreaterThanOrEqual(333); }
  });

  it('stop (party close) turns every machine segment off and runs preset 1', () => {
    e.champion(WHIRLWIND, MAG);
    e.stop();
    const last = sent.at(-1);
    expect(last.ps).toBe(1);
    for (const id of [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14]) expect(last.seg.find(s => s.id === id).on).toBe(false);
    const n = sent.length;
    vi.advanceTimersByTime(10000);
    expect(sent.length).toBe(n); // no stray restores after stop
  });

  it('never writes presets other than recalling preset 1, and never touches hardware config', () => {
    e.start(); e.partyOpen(); e.score(1, MAG); e.setHouse(true); e.setHouse(false); e.stop();
    vi.advanceTimersByTime(10000);
    for (const p of sent) {
      expect(p.psave).toBeUndefined();
      expect(p.pdel).toBeUndefined();
      if (p.ps !== undefined) expect(p.ps).toBe(1);
    }
  });

  it('house lights hold until turned off, and block score effects', () => {
    e.setHouse(true);
    expect(segsFor(0).at(-1)).toMatchObject({ col: [[0, 0, 0, 255]] });
    const n = sent.length;
    e.score(WHIRLWIND, MAG);
    vi.advanceTimersByTime(10000);
    expect(sent.length).toBe(n);
    e.setHouse(false);
    expect(segsFor(0).at(-1).fx).toBe(LIGHTS.effects.Colorwaves);
  });

  it('the curb stacks under the beam band: same width per machine, band and curb the same length', () => {
    e.start();
    const segs = sent[0].seg, get = id => (id >= 2 && id <= 14 && id !== 8 ? { id, ...e.bounds[id] } : segs.find(s => s.id === id));
    for (let i = 0; i < 6; i++) {
      const t = get(2 + i), c = get(9 + i);
      expect(t.stop - t.start).toBe(c.stop - c.start);
    }
    expect(get(1).stop - get(1).start).toBe(get(8).stop - get(8).start); // curb made the beam's length
    // Shifted by the offset, each curb machine zone sits under its beam zone.
    const len = get(8).stop - get(8).start;
    // WLED shows effect pixel (r - offset) at curb pixel r, so each curb zone lines up with its beam zone.
    for (let i = 0; i < 6; i++) expect(get(2 + i).start - get(1).start).toBe((((get(9 + i).start - get(8).start - get(8).of) % len) + len) % len);
  });

  it('band and curb always change in the same message with the same effect (they stay in sync)', () => {
    e.start(); e.partyOpen(); e.leader(MAG); e.setHouse(true); e.setHouse(false); e.revealCue({ color: CYAN }); e.revealEnd();
    vi.advanceTimersByTime(10000);
    for (const p of sent) {
      const b = (p.seg || []).find(s => s.id === 1), c = (p.seg || []).find(s => s.id === 8);
      if (b && b.fx !== undefined) {
        expect(c).toBeTruthy();
        expect({ fx: c.fx, col: c.col, sx: c.sx, bri: c.bri }).toEqual({ fx: b.fx, col: b.col, sx: b.sx, bri: b.bri });
      }
    }
  });

  it('music mode: the ambient layers run the sound effect, and flashes still play on top', () => {
    e.start();
    e.setMusic('Gravcentric');
    for (const id of [0, 1, 8]) expect(segsFor(id).at(-1).fx).toBe(LIGHTS.effects.Gravcentric);
    e.score(WHIRLWIND, MAG);
    vi.advanceTimersByTime(100);
    expect(segsFor(11).at(-1)).toMatchObject({ on: true, fx: LIGHTS.effects.Breathe });
    e.leader(CYAN);
    vi.advanceTimersByTime(6500);
    expect(segsFor(8).at(-1).fx).toBe(LIGHTS.effects.Gravcentric); // back to music after the wash
    e.setMusic(null);
    expect(segsFor(8).at(-1).fx).toBe(LIGHTS.effects.Colorwaves);
  });

  it('ambient effects rotate together on all three layers', () => {
    e.start();
    const first = segsFor(8).at(-1).fx;
    vi.advanceTimersByTime(LIGHTS.ambientMinutes * 60000 + 100);
    const next = sent.at(-1).seg;
    const fxs = [0, 1, 8].map(id => next.find(s => s.id === id)?.fx);
    expect(new Set(fxs).size).toBe(1);
    expect(fxs[0]).not.toBe(first);
  });

  it('white flashes for a champion and a new leader stay at 3 per second or slower', () => {
    const times = [];
    e.destroy(); sent = [];
    e = new LightsEngine({ send: p => sent.push({ t: Date.now(), p }) });
    const t0 = Date.now();
    e.champion(WHIRLWIND, MAG);
    vi.advanceTimersByTime(2000);
    for (const { t, p } of sent) if ((p.seg || []).some(s => s.id === 4 && s.col?.[0]?.[3] === 255)) times.push(t - t0);
    expect(times.length).toBe(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(333);
    e.leader(CYAN);
    vi.advanceTimersByTime(100);
    expect(sent.at(-1).p.seg.find(s => s.id === 1).col).toEqual([[0, 0, 0, 255]]);
  });

  it('the simulator draws each curb pixel the same color as the beam pixel above it', async () => {
    const { newModel, applyMessage, renderRange } = await import('./render.js');
    const { bandOf, defaultZones } = await import('./config.js');
    globalThis.performance ??= { now: () => Date.now() };
    for (const fx of ['Plasma', 'Colorwaves', 'Flow']) {
      const m = newModel();
      const eng = new LightsEngine({ send: msg => applyMessage(m, msg) });
      eng.start(); eng.setAmbient(LIGHTS.ambientCycle.findIndex(a => a.fx === fx));
      const now = performance.now() + 1234;
      const band = bandOf(defaultZones());
      const top = renderRange(m, band.start, band.stop, now);
      const curb = renderRange(m, 235, 320, now);
      expect(curb).toEqual(top);
      eng.destroy();
    }
  });

  it('top and curb can do different things: the bounce alternates them', () => {
    e.start(); sent = [];
    e.pingPong(MAG);
    const colOf = (id) => sent.at(-1).seg.find(s => s.id === id)?.col?.[0];
    vi.advanceTimersByTime(60);
    expect(colOf(1)).toEqual(MAG); expect(colOf(8)).toEqual([0, 0, 0, 0]);
    vi.advanceTimersByTime(300);
    expect(colOf(1)).toEqual([0, 0, 0, 0]); expect(colOf(8)).toEqual(MAG);
    vi.advanceTimersByTime(3000);
    const fx = [0, 1, 8].map(id => segsFor(id).at(-1).fx);
    expect(new Set(fx).size).toBe(1); // back to the shared ambient effect
  });

  it('the top run is one smooth pattern across the wall/beam corners (no restart at the corners)', async () => {
    const { newModel, applyMessage, renderRange } = await import('./render.js');
    globalThis.performance ??= { now: () => Date.now() };
    const m = newModel();
    const eng = new LightsEngine({ send: msg => applyMessage(m, msg) });
    eng.start(); eng.setAmbient(LIGHTS.ambientCycle.findIndex(a => a.fx === 'Plasma'));
    vi.advanceTimersByTime(100);
    const s0 = m.segs[0], s1 = m.segs[1];
    expect([s1.start, s1.stop]).toEqual([s0.start, s0.stop]);
    const now = performance.now() + 777;
    const whole = renderRange(m, 0, 235, now);
    delete m.segs[1]; // only the single whole-run segment left
    expect(renderRange(m, 0, 235, now)).toEqual(whole);
    eng.destroy();
  });

  it('machine effects are symmetric (mirrored from the machine center), never one-way', () => {
    e.start(); sent = [];
    e.champion(DND_ID, MAG); e.score(DND_ID, MAG);
    vi.advanceTimersByTime(2000);
    const mach = sent.flatMap(p => p.seg || []).filter(s => s.id >= 2 && s.id <= 14 && s.id !== 8 && s.on);
    expect(mach.length).toBeGreaterThan(0);
    for (const s of mach) expect(s).toMatchObject({ mi: true, rev: true });
  });

  it('shutting down mid-flash turns the machine off instead of freezing on white', () => {
    e.start();
    e.champion(DND_ID, MAG);
    vi.advanceTimersByTime(60); // the white frame is showing
    sent = [];
    e.destroy();
    const last = sent.flatMap(p => p.seg || []).filter(s => s.id === 7).at(-1);
    expect(last).toMatchObject({ on: false });
  });

  it('idle machine zones get "off" re-sent, so a dropped message cannot leave one lit', () => {
    e.start(); sent = [];
    vi.advanceTimersByTime(5100);
    const ids = sent.flatMap(p => p.seg || []).filter(s => s.on === false).map(s => s.id);
    for (const id of [2, 7, 9, 14]) expect(ids).toContain(id);
  });

  it('ambient colors stay in the cool palette (no rainbow effects)', () => {
    for (const a of LIGHTS.ambientCycle) {
      expect(['Pride 2015', 'Colorloop', 'Rainbow']).not.toContain(a.fx);
      for (const n of a.col || []) expect(LIGHTS.coolColors[n]).toBeTruthy();
    }
  });

  it('TV moments: ranked breathes the room, milestone bounces gold, shame sags to dim red; all recover', () => {
    for (const [fn, check] of [
      [() => e.ranked(CYAN), s => s.fx === LIGHTS.effects.Breathe && JSON.stringify(s.col[0]) === JSON.stringify(CYAN)],
      [() => e.milestone(), s => s.col?.[0]?.[0] === 255 && s.col[0][1] === 170],
      [() => e.shame(), s => s.fx === LIGHTS.effects.Breathe && s.bri === 110],
    ]) {
      e.start(); sent = [];
      fn();
      vi.advanceTimersByTime(60);
      const segs = sent.flatMap(p => p.seg || []);
      expect(segs.some(s => [0, 1, 8].includes(s.id) && check(s))).toBe(true);
      vi.advanceTimersByTime(8000);
      const fx = [0, 1, 8].map(id => segsFor(id).at(-1).fx);
      expect(new Set(fx).size).toBe(1); // back to the shared ambient effect
    }
  });

  it('after the controller reboots, resync pushes the zones and the look again', () => {
    e.start(); sent = [];
    e.resync();
    vi.advanceTimersByTime(60);
    const segs = sent.flatMap(p => p.seg || []);
    for (const id of [0, 1, 8, 2, 7, 9, 14]) expect(segs.some(s => s.id === id && s.start !== undefined)).toBe(true);
    expect(segs.find(s => s.id === 8 && s.fx !== undefined)).toBeTruthy();
  });

  it('segments always go out in ascending id order (WLED appends new ones at the next slot)', () => {
    e.start(); e.champion(WHIRLWIND, MAG); e.leader(CYAN);
    vi.advanceTimersByTime(6000);
    for (const p of sent) {
      const ids = (p.seg || []).map(s => s.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
    }
    expect(sent[0].seg.map(s => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('after the party closes to your preset, the next effect pushes the zones first', () => {
    e.start(); e.stop(); sent = [];
    e.test(WHIRLWIND, MAG);
    vi.advanceTimersByTime(60);
    const ids = sent[0].seg.map(s => s.id);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(sent[0].seg.find(s => s.id === 11)).toMatchObject({ on: true, fx: LIGHTS.effects.Breathe });
  });

  it('idle machine zones are parked on invisible pixels, never over the real strips', () => {
    e.start();
    vi.advanceTimersByTime(60);
    for (const id of [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14]) {
      const s = segsFor(id).at(-1);
      expect(s.on).toBe(false);
      expect(s.start).toBeGreaterThanOrEqual(320); // past the real 85-pixel curb (235–319)
      expect(s.stop).toBeLessThanOrEqual(470); // still inside output 2's padded length
    }
    const starts = [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14].map(id => segsFor(id).at(-1).start);
    expect(new Set(starts).size).toBe(12);
  });

  it('a machine effect moves the zone onto its real pixels, and back to its parking spot after', () => {
    e.start(); sent = [];
    e.score(WHIRLWIND, MAG);
    vi.advanceTimersByTime(100);
    const on = segsFor(11).at(-1);
    expect(on).toMatchObject({ on: true, start: e.bounds[11].start, stop: e.bounds[11].stop });
    expect(on.start).toBeLessThan(320);
    vi.advanceTimersByTime(3500);
    expect(segsFor(11).at(-1).start).toBeGreaterThanOrEqual(320);
  });

  it('after close, an effect plays and then your preset starts again; resync leaves the preset alone', () => {
    e.start(); e.stop(); sent = [];
    e.test(WHIRLWIND, MAG);
    vi.advanceTimersByTime(3600);
    expect(sent.at(-1).ps).toBe(LIGHTS.ambientPreset);
    sent = [];
    e.resync(); vi.advanceTimersByTime(60);
    expect(sent.length).toBe(0);
    vi.advanceTimersByTime(70000); // no keep-off or minute re-push while your preset runs
    expect(sent.length).toBe(0);
  });

  it('the minute re-push never cuts off a zone that is mid-effect', () => {
    e.start();
    vi.advanceTimersByTime(59000); sent = [];
    e.champion(WHIRLWIND, MAG);
    vi.advanceTimersByTime(1500); // the 60 s re-push lands during the champion effect
    const offs = sent.flatMap(p => p.seg || []).filter(s => (s.id === 4 || s.id === 11) && s.on === false);
    expect(offs).toEqual([]);
  });
});
