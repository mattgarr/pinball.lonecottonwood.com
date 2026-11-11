import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDirector, LEVELS, TIMING, clockClip, revealEventCue, stingFor } from './policy.js';

function rig(settings = {}) {
  const calls = [];
  let playing = true;
  const out = {
    music: (v, r) => calls.push(['music', v, r]),
    pauseMusic: () => { playing = false; calls.push(['pause']); },
    resumeMusic: () => { playing = true; calls.push(['resume']); },
    isPlaying: () => playing,
    sound: (n, o) => calls.push(['sound', n, o?.n]),
    voice: c => { calls.push(['voice', c]); return 2000; },
    stopSounds: () => calls.push(['stop']),
    levels: l => calls.push(['levels', l]),
  };
  const d = new AudioDirector({ out, settings: { musicVol: 1, ...settings } });
  d.apply(0);
  calls.length = 0;
  const last = name => [...calls].reverse().find(c => c[0] === name);
  const sounds = () => calls.filter(c => c[0] === 'sound').map(c => c[1]);
  return { d, calls, last, sounds, setPlaying: v => { playing = v; } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T19:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('board moments', () => {
  it('small moments play but never duck', () => {
    const { d, calls } = rig();
    expect(d.gate('coin')).toBe(true);
    expect(calls.find(c => c[0] === 'music')).toBeUndefined();
  });
  it('small blips are rate limited', () => {
    const { d } = rig();
    expect(d.gate('coin')).toBe(true);
    expect(d.gate('climb')).toBe(false);
    vi.advanceTimersByTime(TIMING.smallGap);
    expect(d.gate('join')).toBe(true);
  });
  it('a big moment ducks to 40% and comes back', () => {
    const { d, last } = rig();
    expect(d.gate('leader')).toBe(true);
    expect(last('music')).toEqual(['music', LEVELS.big, TIMING.attack]);
    vi.advanceTimersByTime(TIMING.bigHold + 10);
    expect(last('music')[1]).toBe(1);
    expect(last('music')[2]).toBe(TIMING.release); // smooth way back up
  });
  it('big moments inside the cooldown do not stack', () => {
    const { d } = rig();
    expect(d.gate('record')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(d.gate('leader')).toBe(false);
    expect(d.bigMoment()).toBe(false);
    vi.advanceTimersByTime(TIMING.bigCooldown);
    expect(d.gate('milestone')).toBe(true);
  });
  it('the Wall of Shame only dips the music', () => {
    const { d, last } = rig();
    d.gate('shame');
    expect(last('music')[1]).toBe(LEVELS.medium);
  });
  it('ducking follows the host music level', () => {
    const { d, last } = rig({ musicVol: 0.5 });
    d.gate('leader');
    expect(last('music')[1]).toBeCloseTo(0.2);
  });
  it('bigMoment plays the attention tone', () => {
    const { d, sounds } = rig();
    expect(d.bigMoment()).toBe(true);
    expect(sounds()).toEqual(['attention']);
  });
});

describe('tournament clock', () => {
  it('maps clock moments to announcer clips', () => {
    expect(clockClip({ what: 'mark', side: 'start', minutes: 5 })).toBe('start5');
    expect(clockClip({ what: 'mark', side: 'end', minutes: 15 })).toBe('end15');
    expect(clockClip({ what: 'mark', side: 'end', minutes: 7 })).toBe(null);
    expect(clockClip({ what: 'start' })).toBe('on');
    expect(clockClip({ what: 'end' })).toBe('timesup');
    expect(clockClip({ what: 'awards' })).toBe('awards');
    expect(clockClip({ what: 'freeplay' })).toBe('freeplay');
  });
  it('intermission and free play: chime, then "gather round" / "free play is open"; never during the reveal', () => {
    const { d, last, sounds } = rig();
    d.clock({ what: 'awards' });
    expect(sounds()).toEqual(['chime']);
    vi.advanceTimersByTime(TIMING.chimeLead);
    expect(last('voice')).toEqual(['voice', 'awards']);
    vi.advanceTimersByTime(10000);
    d.clock({ what: 'freeplay' });
    vi.advanceTimersByTime(TIMING.chimeLead);
    expect(last('voice')).toEqual(['voice', 'freeplay']);
    const r = rig();
    r.d.revealStart();
    r.d.clock({ what: 'awards' });
    vi.advanceTimersByTime(5000);
    expect(r.last('voice')).toBe(undefined);
  });
  it('a minute mark: chime, then the voice, music at 25% until the clip ends', () => {
    const { d, calls, last, sounds } = rig();
    d.clock({ what: 'mark', side: 'start', minutes: 5 });
    expect(sounds()).toEqual(['chime']);
    expect(last('music')[1]).toBe(LEVELS.voice);
    vi.advanceTimersByTime(TIMING.chimeLead);
    expect(last('voice')).toEqual(['voice', 'start5']);
    vi.advanceTimersByTime(2000 + TIMING.voiceTail - 50);
    expect(last('music')[1]).toBe(LEVELS.voice);
    vi.advanceTimersByTime(100);
    expect(last('music')[1]).toBe(1);
    expect(calls.filter(c => c[0] === 'voice')).toHaveLength(1);
  });
  it('voice off: chime and a short duck, no clip', () => {
    const { d, calls, last } = rig({ voiceOn: false });
    d.clock({ what: 'mark', side: 'end', minutes: 10 });
    expect(last('music')[1]).toBe(LEVELS.big);
    vi.advanceTimersByTime(5000);
    expect(calls.find(c => c[0] === 'voice')).toBeUndefined();
  });
  it('the start: fanfare then "the tournament is on"', () => {
    const { d, last, sounds } = rig();
    d.clock({ what: 'start', side: 'start', minutes: 0 });
    expect(sounds()).toEqual(['fanfare']);
    vi.advanceTimersByTime(TIMING.fanfareLead);
    expect(last('voice')[1]).toBe('on');
  });
  it('final ten seconds: a boop each second at 12% music, BEEEP after 1, then the voice, then music back', () => {
    const { d, calls, last, sounds } = rig();
    for (let n = 10; n >= 1; n--) { d.tick(n); vi.advanceTimersByTime(n > 1 ? 1000 : 0); }
    expect(sounds()).toEqual(Array(10).fill('boop'));
    expect(calls.filter(c => c[0] === 'sound').map(c => c[2])).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(last('music')[1]).toBe(LEVELS.final);
    expect(d.gate('leader')).toBe(false); // board sounds wait
    vi.advanceTimersByTime(TIMING.beepLead);
    expect(sounds().at(-1)).toBe('endBeep');
    d.clock({ what: 'end', side: 'end', minutes: 0 }); // the end card a moment later
    expect(sounds().filter(s => s === 'endBeep')).toHaveLength(1); // only one BEEEP
    vi.advanceTimersByTime(10);
    expect(last('voice')[1]).toBe('timesup');
    vi.advanceTimersByTime(2000 + TIMING.voiceTail + 10);
    expect(last('music')[1]).toBe(1);
  });
  it('an end card without the countdown still BEEEPs first', () => {
    const { d, last, sounds } = rig();
    d.clock({ what: 'end', side: 'end', minutes: 0 });
    expect(sounds()).toEqual(['endBeep']);
    vi.advanceTimersByTime(TIMING.beepLen);
    expect(last('voice')[1]).toBe('timesup');
  });
  it('a stuck countdown lets go of the music by itself', () => {
    const { d, last } = rig();
    d.tick(10);
    vi.advanceTimersByTime(TIMING.finalSafety + 2000);
    expect(last('music')[1]).toBe(1);
    expect(d.final).toBe(false);
  });
});

describe('winner reveal', () => {
  it('fades the music to silence and pauses it', () => {
    const { d, calls, last } = rig();
    d.revealStart();
    expect(last('music')).toEqual(['music', 0, TIMING.revealFade]);
    vi.advanceTimersByTime(TIMING.revealFade + 200);
    expect(calls.some(c => c[0] === 'pause')).toBe(true);
    // stays silent through big moments and minute marks
    expect(d.gate('leader')).toBe(false);
    d.clock({ what: 'mark', side: 'end', minutes: 5 });
    vi.advanceTimersByTime(5000);
    expect(last('music')[1]).toBe(0);
    expect(calls.find(c => c[0] === 'voice')).toBeUndefined();
  });
  it('restores the music with a fade up when it ends', () => {
    const { d, calls, last } = rig({ musicVol: 0.7 });
    d.revealStart();
    vi.advanceTimersByTime(4000);
    d.revealEnd();
    expect(calls.some(c => c[0] === 'resume')).toBe(true);
    expect(last('music')).toEqual(['music', 0.7, TIMING.revealRestore]);
  });
  it('does not restart music the host had paused', () => {
    const { d, calls, setPlaying } = rig();
    setPlaying(false);
    d.revealStart();
    d.revealEnd();
    expect(calls.some(c => c[0] === 'resume')).toBe(false);
  });
  it('plays a slide timeline and cancels it when the host moves on', () => {
    const { d, sounds } = rig();
    d.revealSlide({ events: [{ at: 0, s: 'tick' }, { at: 1000, s: 'tick' }, { at: 2000, s: 'tick' }], show: 3000 });
    vi.advanceTimersByTime(1500);
    d.revealSlide({ grand: true, events: [{ at: 0, s: 'tick' }], show: 500 }); // Next pressed early
    vi.advanceTimersByTime(5000);
    expect(sounds()).toEqual(['tick', 'tick', 'tick', 'grandSting']);
  });
  it('a reveal cue mutes the music first, then plays', () => {
    const { d, last, sounds } = rig();
    d.revealCue('tick');
    expect(d.reveal).toBe(true);
    expect(last('music')[1]).toBe(0);
    expect(sounds()).toEqual(['tick']);
    d.setSettings({ muteAll: true });
    expect(d.revealCue('sting')).toBe(false);
  });
  it('maps the reveal events to sounds', () => {
    expect(revealEventCue({ what: 'count', n: 2 })).toBe('tick');
    expect(revealEventCue({ what: 'show', label: 'GRAND CHAMPION' })).toBe('grandSting');
    expect(revealEventCue({ what: 'show', label: 'THE BIG WHIFF' })).toBe('whiff');
    expect(revealEventCue({ what: 'show', label: 'THE MATCH', empty: true })).toBe('noWinner');
    expect(revealEventCue({ what: 'show', label: 'FATHOM CHAMPION' })).toBe('sting');
    expect(revealEventCue({ what: 'intro' })).toBe('introSting');
    expect(revealEventCue({ what: 'finale', back: true })).toBe(null);
    expect(revealEventCue({ what: 'walk' })).toBe(null);
  });
  it('picks the winner sting', () => {
    expect(stingFor({ grand: true })).toBe('grandSting');
    expect(stingFor({ empty: true, grand: true })).toBe('noWinner');
    expect(stingFor({ whiff: true })).toBe('whiff');
    expect(stingFor({})).toBe('sting');
  });
  it('the reveal cancels a running countdown', () => {
    const { d, sounds } = rig();
    d.tick(3);
    d.revealStart();
    vi.advanceTimersByTime(5000);
    expect(sounds()).toEqual(['boop']);
  });
});

describe('host controls', () => {
  it('mute all silences music and effects; unmute brings them back', () => {
    const { d, last } = rig();
    d.setSettings({ muteAll: true });
    expect(last('music')[1]).toBe(0);
    expect(last('levels')[1]).toEqual({ fx: 0, voice: 0 });
    expect(d.gate('coin')).toBe(false);
    d.setSettings({ muteAll: false });
    expect(last('music')[1]).toBe(1);
  });
  it('duck now holds 25% for a while', () => {
    const { d, last } = rig();
    d.duckNow();
    expect(last('music')[1]).toBe(LEVELS.manual);
    vi.advanceTimersByTime(TIMING.manualHold + 10);
    expect(last('music')[1]).toBe(1);
  });
  it('stop all cuts everything and pauses the music', () => {
    const { d, calls } = rig();
    d.clock({ what: 'mark', side: 'start', minutes: 3 });
    d.stopAll();
    vi.advanceTimersByTime(5000);
    expect(calls.some(c => c[0] === 'stop')).toBe(true);
    expect(calls.some(c => c[0] === 'pause')).toBe(true);
    expect(calls.find(c => c[0] === 'voice')).toBeUndefined();
  });
  it('the deepest duck wins when two overlap', () => {
    const { d, last } = rig();
    d.gate('leader');
    d.clock({ what: 'mark', side: 'end', minutes: 1 });
    expect(last('music')[1]).toBe(LEVELS.voice);
  });
});

describe('spoken lines', () => {
  it('a live line dips the music until the line starts, then for exactly its length', async () => {
    const { d, last, calls } = rig();
    let start;
    d.out.say = t => { calls.push(['say', t]); return new Promise(r => { start = r; }); };
    expect(d.speak('New Fathom record!', { lead: 1000 })).toBe(true);
    expect(last('music')[1]).toBe(LEVELS.voice);
    vi.advanceTimersByTime(1000);
    expect(last('say')[1]).toBe('New Fathom record!');
    vi.advanceTimersByTime(4000); // still waiting for the AI voice
    expect(last('music')[1]).toBe(LEVELS.voice);
    start(3000);
    await Promise.resolve(); await Promise.resolve();
    vi.advanceTimersByTime(3000 + TIMING.voiceTail - 50);
    expect(last('music')[1]).toBe(LEVELS.voice);
    vi.advanceTimersByTime(100);
    expect(last('music')[1]).toBe(1);
  });
  it('a skipped line lets the music straight back up', async () => {
    const { d, last } = rig();
    d.out.say = () => Promise.resolve(0);
    d.speak('Welcome, Ann.');
    vi.advanceTimersByTime(10);
    await Promise.resolve(); await Promise.resolve();
    vi.advanceTimersByTime(TIMING.release + 10);
    expect(last('music')[1]).toBe(1);
  });
  it('quiet during the reveal and the final 10 s; reveal lines only during the reveal', () => {
    const { d, calls } = rig();
    d.out.say = t => { calls.push(['say', t]); return 1000; };
    expect(d.speak('Grand Champion!', { reveal: true })).toBe(false);
    d.revealStart();
    expect(d.speak('Welcome, Ann.')).toBe(false);
    expect(d.speak('Grand Champion!', { reveal: true, lead: 500 })).toBe(true);
    vi.advanceTimersByTime(600);
    expect(calls.filter(c => c[0] === 'say').map(c => c[1])).toEqual(['Grand Champion!']);
    d.revealEnd();
    d.tick(10);
    expect(d.speak('Welcome, Bob.')).toBe(false);
  });
  it('announcer off or muted: nothing is said', () => {
    expect(rig({ voiceOn: false }).d.speak('hi')).toBe(false);
    expect(rig({ muteAll: true }).d.speak('hi')).toBe(false);
  });
});
