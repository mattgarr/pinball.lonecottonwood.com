import { describe, it, expect } from 'vitest';
import { BOOTH, BoothRunner, boothGap, boothMode, buildDigest, nearMark, safeLines, unsafe } from './booth.js';
import { partyNight } from './booth.fixture.js';

describe('booth digest', () => {
  it('tells the hosts what is going on, in speakable words', () => {
    const n = partyNight();
    const d = buildDigest({ ...n, mode: 'tournament' });
    expect(d.mode).toBe('tournament');
    expect(d.minutesLeft).toBe(110);
    expect(d.recent.find(r => r.machine === 'Fathom' && r.player === 'Big Dave')).toMatchObject({ score: 'nine point two million', place: 1, minutesAgo: 2, personalBest: true });
    expect(d.recent[0].minutesAgo).toBeLessThanOrEqual(d.recent[1].minutesAgo);
    expect(d.machineTops.find(m => m.machine === 'Dungeons and Dragons')).toBeTruthy();
    expect(d.leaders).toHaveLength(3);
    expect(d.hotStreak?.topThreeGames).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(d)).toContain('"Stacia"'); // the emoji is gone (the voice respells her; the text keeps her name)
    expect(JSON.stringify(d)).not.toContain('🎱');
    expect(JSON.stringify(d)).not.toMatch(/\d{4,}/); // no raw big numbers
    expect(JSON.stringify(d).length).toBeLessThan(4000);
  });
  it('sealed: no standings at all', () => {
    const d = buildDigest({ ...partyNight(), mode: 'lastcall', sealed: true });
    expect(d.leaders).toBeUndefined();
    expect(d.closeRace).toBeUndefined();
    expect(d.sealed).toBe(true);
  });
  it('free play counts every game and has no standings', () => {
    const n = partyNight();
    const d = buildDigest({ ...n, mode: 'freeplay' });
    expect(d.gamesTonight).toBe(n.scores.length);
    expect(d.leaders).toBeUndefined();
    expect(buildDigest({ ...n, mode: 'tournament' }).gamesTonight).toBe(n.scores.filter(s => !s.free_play).length);
  });
  it('only plays in the right phases', () => {
    expect(boothMode('pre')).toBe('warmup');
    expect(boothMode('on')).toBe('tournament');
    expect(boothMode('on', { lastCall: true })).toBe('lastcall');
    expect(boothMode('free')).toBe('freeplay');
    for (const p of ['grace', 'over', 'reveal', 'closed', undefined]) expect(boothMode(p)).toBeNull();
  });
});

describe('booth safety', () => {
  it('blocks bad words and teasing about anything but pinball', () => {
    expect(unsafe('What a shot!')).toBe(false);
    expect(unsafe('That game was a sh1t show')).toBe(true);
    expect(unsafe('Omar, you absolute idiot')).toBe(true);
    expect(unsafe('Grandpa Joe is too old for this')).toBe(true);
    expect(unsafe('Grab a beer, Theo!')).toBe(true);
    expect(unsafe('Stacia is on a hot streak!')).toBe(false);
    expect(unsafe('What an idiot!')).toBe(true);
    expect(unsafe('What a game!!!')).toBe(false);
  });
  const ok = [{ host: 'DONNIE', text: 'Alllll right! Big Dave just went nuts on Fathom!' }, { host: 'DASH', text: 'Nine point two million, folks! Unreal!' }];
  it('checks the shape of a bit', () => {
    expect(safeLines(ok)).toBe(ok);
    expect(safeLines([ok[0]])).toBeNull();
    expect(safeLines([...ok, { host: 'BOB', text: 'hi' }])).toBeNull();
    expect(safeLines([ok[0], { host: 'DASH', text: 'x'.repeat(300) }])).toBeNull();
    expect(safeLines([ok[0], { host: 'DASH', text: 'Total crap game.' }])).toBeNull();
  });
  it('while sealed, nothing about who is leading', () => {
    const lead = [ok[0], { host: 'DASH', text: 'And Big Dave is still leading the pack!' }];
    expect(safeLines(lead)).toBe(lead);
    expect(safeLines(lead, { sealed: true })).toBeNull();
    expect(safeLines(ok, { sealed: true })).toBe(ok);
  });
});

describe('booth scheduler', () => {
  const party = { tourney_starts_at: '2026-11-15T02:30:00Z', tourney_ends_at: '2026-11-15T05:30:00Z' };
  const S = Date.parse('2026-11-15T02:30:00Z');
  it('gaps by phase and frequency', () => {
    expect(boothGap('tournament', 'normal', () => 0)).toBe(6 * 60000);
    expect(boothGap('tournament', 'normal', () => 1)).toBe(8 * 60000);
    expect(boothGap('freeplay', 'normal', () => 0.5)).toBe(10 * 60000);
    expect(boothGap('tournament', 'more', () => 0)).toBe(Math.round(6 * 60000 * 0.6));
  });
  it('stays out of the way of countdown moments', () => {
    expect(nearMark(party, S - 5 * 60000 - 30000)).toBe(true);   // 30 s before "starts in 5"
    expect(nearMark(party, S + 20 * 60000)).toBe(false);          // mid-tournament
    expect(nearMark(party, Date.parse(party.tourney_ends_at) - 15 * 60000 + 10000)).toBe(true); // just after last call
  });

  function rig({ mode = 'tournament', quiet = true, near = false } = {}) {
    let t = S + 30 * 60000;
    const room = { mode, sealed: false, quiet, nearMark: near };
    const played = [], fetched = [];
    let answer = () => ({ url: 'u', ms: 15000, lines: [{ host: 'DONNIE', text: 'Hi there!' }, { host: 'DASH', text: 'Let us go, folks!' }] });
    const settings = { boothOn: true, boothFreq: 'normal' };
    const r = new BoothRunner({
      now: () => t, rand: () => 0, settings: () => settings,
      room: () => ({ ...room, digest: () => ({ mode: room.mode }) }),
      fetchBit: d => { fetched.push(d); return Promise.resolve(answer()); },
      play: b => { if (!room.quiet) return false; played.push(b); return true; },
    });
    const flush = () => new Promise(res => setTimeout(res, 0));
    return { r, room, played, fetched, settings, adv: ms => { t += ms; }, now: () => t, flush, setAnswer: f => { answer = f; } };
  }
  it('fetches ahead, then plays when it is due and the room is quiet', async () => {
    const x = rig();
    expect(x.r.tick()).toBe('waiting'); // first one after half a gap (3 min)
    x.adv(3 * 60000 - BOOTH.prefetch);
    expect(x.r.tick()).toBe('fetching');
    await x.flush();
    expect(x.r.tick()).toBe('waiting');
    x.adv(BOOTH.prefetch);
    x.room.quiet = false;
    expect(x.r.tick()).toBe('holding'); // something else is on
    x.room.quiet = true;
    expect(x.r.tick()).toBe('played');
    expect(x.played).toHaveLength(1);
    expect(x.r.log).toHaveLength(1);
    expect(x.r.nextAt - x.now()).toBe(15000 + 6 * 60000);
  });
  it('throws away a stale bit and makes a new one', async () => {
    const x = rig();
    x.r.tick(); x.adv(3 * 60000 - BOOTH.prefetch); x.r.tick(); await x.flush();
    x.room.quiet = false;
    x.adv(BOOTH.stale + 1000);
    expect(x.r.tick()).toBe('fetching');
    expect(x.fetched).toHaveLength(2);
  });
  it('a juicy moment brings the next bit forward, once per few minutes, with the news in it', async () => {
    const x = rig();
    x.r.tick();
    x.r.event({ kind: 'record', text: 'Big Dave set a new Fathom record' });
    expect(x.r.nextAt - x.now()).toBe(BOOTH.extraAfter);
    const due = x.r.nextAt;
    x.r.event({ kind: 'leader', text: 'Theo took the lead' });
    expect(x.r.nextAt).toBe(due); // no second extra right away
    x.r.tick(); await x.flush();
    expect(x.fetched[0].justHappened).toEqual(['Big Dave set a new Fathom record', 'Theo took the lead']);
  });
  it('drops an unsafe bit and tries again later', async () => {
    const x = rig();
    x.setAnswer(() => ({ url: 'u', ms: 9000, lines: [{ host: 'DONNIE', text: 'What an idiot!' }, { host: 'DASH', text: 'Ha!' }] }));
    x.r.tick(); x.adv(3 * 60000); x.r.tick(); await x.flush();
    expect(x.r.tick()).toBe('waiting');
    expect(x.played).toHaveLength(0);
  });
  it('off, or no booth in this phase: nothing', () => {
    const x = rig({ mode: null });
    expect(x.r.tick()).toBe('off');
    const y = rig(); y.settings.boothOn = false;
    expect(y.r.tick()).toBe('off');
  });
  it('play now skips the wait (even as the very first thing)', async () => {
    const x = rig();
    x.r.playNow();
    expect(x.r.tick()).toBe('fetching');
    await x.flush();
    expect(x.r.tick()).toBe('played');
  });
});

describe('booth duo and chill', () => {
  it('any two voices, never the same twice; default Tiffani + Donnie', async () => {
    const { boothDuo, BOOTH_PERSONAS } = await import('./booth.js');
    expect(boothDuo({})).toEqual(['valley', 'dj']);
    expect(boothDuo({ boothA: 'valley', boothB: 'hype' })).toEqual(['valley', 'hype']);
    expect(boothDuo({ boothA: 'dj', boothB: 'dj' })).toEqual(['dj', 'valley']);
    expect(boothDuo({ boothA: 'nope', boothB: 'rink' })).toEqual(['valley', 'rink']);
    expect(Object.keys(BOOTH_PERSONAS)).toHaveLength(14);
    expect(new Set(Object.values(BOOTH_PERSONAS).map(p => p.name)).size).toBe(14);
  });
  it('checks lines against the chosen hosts', () => {
    const lines = [{ host: 'ROXY', text: 'Feel the burn!' }, { host: 'DASH', text: 'What a game!' }];
    expect(safeLines(lines, { hosts: ['ROXY', 'DASH'] })).toBe(lines);
    expect(safeLines(lines, { hosts: ['TIFFANI', 'DASH'] })).toBeNull();
  });
  it('chill: no extra bit after a juicy moment', () => {
    let t = Date.parse('2026-11-15T03:00:00Z');
    const r = new BoothRunner({ now: () => t, rand: () => 0, settings: () => ({ boothOn: true, boothExtras: false }), room: () => ({ mode: 'tournament', quiet: true, digest: () => ({}) }), fetchBit: () => null, play: () => true });
    r.tick();
    const due = r.nextAt;
    r.event({ kind: 'record', text: 'x' });
    expect(r.nextAt).toBe(due);
    expect(r.events).toHaveLength(1); // still told about it
  });
  it('a different duo throws away the bit made for the old one', async () => {
    let t = Date.parse('2026-11-15T03:00:00Z'), duo = 'aerobics+hype';
    const r = new BoothRunner({ now: () => t, rand: () => 0, settings: () => ({ boothOn: true, duo }), room: () => ({ mode: 'tournament', quiet: true, digest: () => ({}) }),
      fetchBit: () => Promise.resolve({ url: 'u', ms: 1000, hosts: ['ROXY', 'DASH'], lines: [{ host: 'ROXY', text: 'Hi there!' }, { host: 'DASH', text: 'Here we go!' }] }), play: () => true });
    r.playNow(); r.tick(); await new Promise(res => setTimeout(res, 0));
    expect(r.bit?.duo).toBe('aerobics+hype');
    duo = 'valley+hype';
    expect(r.tick()).toBe('fetching');
  });
});
