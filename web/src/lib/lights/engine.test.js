import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LightsEngine } from './engine.js';
import { LIGHTS } from './config.js';

const MAG = [255, 0, 170, 0];
const CYAN = [0, 229, 255, 0];
// Machine segments by physical position: Whirlwind is 3rd from the left → top 3, curb 10.
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
    for (let id = 1; id <= 6; id++) expect(segs.find(s => s.id === id).on).toBe(false);
    for (let id = 8; id <= 13; id++) expect(segs.find(s => s.id === id).on).toBe(false);
    expect(segs.find(s => s.id === 0).fx).toBe(LIGHTS.effects.Colorloop);
    expect(segs.find(s => s.id === 10).start).toBeGreaterThanOrEqual(235); // curb zones on the curb run
  });

  it('a score pulses that machine\'s curb zone within 1 s and restores it within 3.5 s', () => {
    e.score(WHIRLWIND, MAG);
    vi.advanceTimersByTime(100);
    const on = segsFor(10);
    expect(on[0]).toMatchObject({ id: 10, on: true, fx: LIGHTS.effects.Breathe, col: [MAG, [0, 0, 0, 0]] });
    vi.advanceTimersByTime(3300);
    expect(segsFor(10).at(-1)).toEqual({ id: 10, on: false });
  });

  it('two machines scoring within 1 s both pulse and both restore', () => {
    e.score(WHIRLWIND, MAG);
    vi.advanceTimersByTime(300);
    e.score(FATHOM, CYAN);
    vi.advanceTimersByTime(4000);
    expect(segsFor(10).filter(s => s.on).length).toBe(1);
    expect(segsFor(8).filter(s => s.on).length).toBe(1);
    expect(segsFor(10).at(-1).on).toBe(false);
    expect(segsFor(8).at(-1).on).toBe(false);
  });

  it('five scores in 2 s on one machine send at most three commands for that segment', () => {
    for (let i = 0; i < 5; i++) { e.score(WHIRLWIND, i % 2 ? MAG : CYAN); vi.advanceTimersByTime(400); }
    const pulses = segsFor(10).filter(s => s.on);
    expect(pulses.length).toBeLessThanOrEqual(3);
    vi.advanceTimersByTime(4000);
    expect(segsFor(10).at(-1).on).toBe(false); // still restores
  });

  it('nearby changes merge into one message', () => {
    e.score(WHIRLWIND, MAG);
    e.score(FATHOM, CYAN);
    vi.advanceTimersByTime(60);
    expect(sent).toHaveLength(1);
    expect(sent[0].seg.map(s => s.id).sort((a, b) => a - b)).toEqual([8, 10]);
  });

  it('a champion preempts a score; a score during a champion effect is dropped', () => {
    e.score(WHIRLWIND, MAG);
    vi.advanceTimersByTime(100);
    e.champion(WHIRLWIND, CYAN);
    vi.advanceTimersByTime(10);
    expect(segsFor(3).at(-1)).toMatchObject({ on: true, fx: LIGHTS.effects['Chase Rainbow'] });
    const n = segsFor(10).length;
    e.score(WHIRLWIND, MAG);
    vi.advanceTimersByTime(200);
    expect(segsFor(10).length).toBe(n);
    vi.advanceTimersByTime(5000);
    expect(segsFor(3).at(-1)).toEqual({ id: 3, on: false });
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
    sent = []; e.destroy();
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
    for (const id of [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]) expect(last.seg.find(s => s.id === id).on).toBe(false);
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
    expect(segsFor(0).at(-1).fx).toBe(LIGHTS.effects.Colorloop);
  });
});
