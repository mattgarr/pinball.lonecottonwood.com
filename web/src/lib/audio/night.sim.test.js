// The whole party night, simulated against the REAL audio runtime (tv.js + the director, the voice queue,
// the booth scheduler, one-liners), with a fake clock and fake outputs: 40 players, free play, the start
// countdown, busy and quiet stretches, last call (sealed), the final 10 s, GAME OVER, the intermission, the
// reveal (all 12 prizes, a Back, a TV reload), free play after, the party closed. Gemini (tts / booth) is
// replaced by fixtures (with an outage in the middle), so nothing touches production.
// It checks the rules (no overlaps, nothing over the countdowns / reveal, nothing about the standings while
// sealed, the music ducks and comes back, the reveal is music-free, the Audio delay schedules the final boops
// early) and reports how chatty each commentary level is (lines per 10 minutes).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- fake browser ----------
class FakeNode { constructor() { this.gain = param(); this.frequency = param(); this.Q = param(); this.threshold = param(); this.ratio = param(); this.attack = param(); this.release = param(); this.knee = param(); } connect(n) { return n; } disconnect() {} }
function param() { return { value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
const fakeCtx = {
  state: 'running', sampleRate: 48000, outputLatency: 0, baseLatency: 0.005,
  get currentTime() { return Date.now() / 1000; },
  destination: new FakeNode(),
  createGain: () => new FakeNode(), createBiquadFilter: () => new FakeNode(), createDynamicsCompressor: () => new FakeNode(),
  createConvolver: () => new FakeNode(), createWaveShaper: () => new FakeNode(),
  createBuffer: (c, n, sr) => ({ duration: n / sr, getChannelData: () => new Float32Array(n) }),
  createBufferSource() {
    const s = new FakeNode();
    let t = null;
    s.start = () => { t = setTimeout(() => s.onended?.(), Math.round((s.buffer?.duration || 0) * 1000)); };
    s.stop = () => { if (t) { clearTimeout(t); t = null; s.onended?.(); } };
    return s;
  },
  decodeAudioData: async b => ({ duration: b.ms / 1000 }),
  resume: async () => {},
};
let gate = null;
vi.mock('../chiptune.js', () => ({
  audioCtx: () => fakeCtx, ensureCtx: () => fakeCtx, fxBus: () => new FakeNode(),
  setGate: g => { gate = g; },
  sound: { wanted: () => true, isOn: () => true, enable: async () => {} },
}));
vi.mock('./synth.js', () => ({ playSound: () => true, stopSounds: () => {} }));
const subs = {};
vi.mock('../lights/mqtt.js', () => ({ publish: () => {}, subscribe: (t, fn) => { subs[t] = fn; return () => {}; } }));
vi.mock('./spotify.js', () => ({ hasLogin: () => false, handleCallback: async () => null, api: async () => null, login: () => {}, logout: () => {}, createPlayer: async () => null, SPOTIFY_CLIENT_ID: 'x' }));
vi.mock('../store.js', () => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_KEY: 'k', getHostPass: () => 'pass' }));

// ---------- Gemini fixtures ----------
const net = { down: false, requests: [] };
const wordsMs = t => Math.max(1200, String(t).split(/\s+/).length * 330);
function fakeFetch(url, opts = {}) {
  const u = String(url);
  if (u.includes('/storage/')) { const ms = Number(/(\d+)\.wav/.exec(u)?.[1] || 2000); return Promise.resolve({ ok: true, arrayBuffer: async () => ({ ms }) }); }
  if (u.includes('/audio/voices/') && u.endsWith('.m4a')) return Promise.resolve({ ok: true, arrayBuffer: async () => ({ ms: 2600, clip: true }) });
  if (u.endsWith('manifest.json')) return Promise.resolve({ ok: true, json: async () => ({ packs: {} }) });
  const body = JSON.parse(opts.body || '{}');
  net.requests.push({ at: Date.now(), url: u, body });
  return new Promise((resolve, reject) => {
    opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    if (net.down) return; // hangs until the caller's timeout aborts it
    const reply = obj => resolve({ ok: true, json: async () => obj });
    if (body.action === 'token') return setTimeout(() => reply({ token: 't', exp: Date.now() + 7 * 864e5 }), 300);
    if (u.endsWith('/booth') && body.kind === 'quip') {
      const text = { bad: 'Oof, that one got away from you, but the next ball is all yours.', pb: 'A brand new personal best, look at you go tonight!', first: 'First game in the books, welcome to the garage, superstar!', top3: 'Straight into the top three on that machine, nice!', close: 'So close you could practically taste that spot!' }[body.moment] || 'What a game, folks, what a game.';
      return setTimeout(() => reply({ url: `https://sb.test/storage/q-${wordsMs(text)}.wav`, ms: wordsMs(text), lines: [{ host: 'TIFFANI', text }] }), 6000);
    }
    if (u.endsWith('/booth')) {
      const lines = [{ host: 'TIFFANI', text: 'Okay the garage is buzzing tonight, the flippers are flipping.' }, { host: 'DONNIE', text: 'Buzzing? I heard a bumper and thought it was my knees.' }, { host: 'TIFFANI', text: 'Your knees have more bounce than your last game.' }];
      const ms = body.short ? 9000 : 17000;
      return setTimeout(() => reply({ url: `https://sb.test/storage/b-${ms}.wav`, ms, lines: body.short ? lines.slice(0, 2) : lines, hosts: ['TIFFANI', 'DONNIE'] }), 13000);
    }
    // tts: ~4.5 s to make a new line
    return setTimeout(() => reply({ url: `https://sb.test/storage/t-${wordsMs(body.text)}.wav`, ms: wordsMs(body.text) }), 4500);
  });
}

// ---------- the night ----------
const MIN = 60000;
const MACHINES = [1, 2, 3, 4, 5, 6].map(id => ({ id, name: ['Centaur', 'Fathom', 'Whirlwind', 'White Water', 'Cactus Canyon', 'Dungeons & Dragons'][id - 1], sort_order: id, active: true }));
const NAMES = ['FlyingGoat', 'Megs', 'Bad B-nott', 'Tilt Tom', 'Flipper Fran', 'Stacia', 'Zack Attack', 'Nudge Queen', 'Ball Saver Bob', 'Jackpot Jen', 'Drain-o', 'Spinner', 'Ramp Rat', 'Plunger Pete', 'Skill Shot Sue', 'Mystery Max', 'Kickback Kim', 'Slingshot Sam', 'Combo Carla', 'Lock Lord', 'Rollover Rita', 'Match Maker', 'Replay Ray', 'High Score Hal', 'Silver Ball Sally', 'Bonus X Bex', 'Multiball Mia', 'Flip Flop', 'Last Ball Lou', 'Pinhead', 'Coin Door Cody', 'Outlane Olivia', 'Magna Save Mo', 'Wizard Wendy', 'Gobble Greg', 'Bumper Carl', 'Extra Ellie', 'Lane Larry', 'Tilt-a-Whirl', 'Captain Max'];

function rng(seed) { let x = seed; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; }

// Score arrival rate (games per minute) by minutes from the start: free play slow, a busy first hour, a quiet
// stretch, a last-call rush.
function rate(m) {
  if (m < -30) return 0.3; if (m < 0) return 0.8; if (m < 60) return 2.6; if (m < 90) return 1.6;
  if (m < 120) return 0.5; if (m < 165) return 1.8; if (m < 180) return 3.2; return 0;
}

async function runNight({ level = 'full', delay = 2.0, switchAt = null, seed = 11 }) {
  vi.resetModules();
  gate = null;
  for (const k of Object.keys(subs)) delete subs[k];
  net.down = false; net.requests = [];
  const tv = await import('./tv.js');
  const { setBoothSource } = await import('./booth.js');
  const { applyLevel } = await import('./commentary.js');
  const { dueClockMoment, finalSeconds, sealed, tourneyPhase, SEAL_MS, LOG_GRACE_MS } = await import('../schedule.js');
  const { soundPlan, showAt } = await import('../revealTiming.js');
  const { AUDIO_DEFAULTS } = tv;
  const rnd = rng(seed);
  const T0 = Date.now() + 40 * MIN; // the start, 40 minutes into free play
  const END = T0 + 180 * MIN;
  const party = { id: 1, status: 'open', reveal_active: false, reveal_step: 0, free_play: false, tourney_starts_at: new Date(T0).toISOString(), tourney_ends_at: new Date(END).toISOString(), revealed_at: null };
  const players = [], scores = [];
  const data = { machines: MACHINES, players, scores, party, phase: 'pre', lastCall: false, sealed: false, takeover: false };
  setBoothSource(() => data);
  const settings0 = applyLevel({ ...AUDIO_DEFAULTS, audioDelay: delay, delayMode: 'manual' }, level);
  let host = tv.startAudioHost();
  subs['audio/settings']?.(settings0);
  const log = tv.auditLog();
  const emit = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail }));
  const marks = []; const fired = new Set();
  let takeoverUntil = 0; let sid = 1; const tq = [];
  const step = async ms => { await vi.advanceTimersByTimeAsync(ms); };
  const tops = new Map(); // machine -> best

  // One simulated second at a time: scores, joins, records, clock moments, the final seconds.
  const second = async () => {
    const now = Date.now();
    data.phase = tourneyPhase(party, now);
    data.sealed = sealed(party, now);
    data.lastCall = data.phase === 'on' && END - now <= SEAL_MS;
    data.takeover = now < takeoverUntil;
    const m = dueClockMoment(party, now, fired);
    if (m) { fired.add(m.key); marks.push({ at: now, ...m }); takeoverUntil = now + 8000; emit('pw:clock', { what: m.minutes ? 'mark' : m.kind, side: m.kind, minutes: m.minutes }); }
    const n = finalSeconds(party, now);
    if (n > 0 && n !== second.lastN) emit('pw:clock', { what: 'tick', side: 'end', n });
    second.lastN = n;
    const mins = (now - T0) / MIN;
    const playing = ['pre', 'on', 'grace', 'free'].includes(data.phase);
    if (playing && players.length < 40 && rnd() < (mins < 30 ? 0.03 : 0.004)) {
      const p = { id: 100 + players.length, display_name: NAMES[players.length], created_at: new Date(now).toISOString() };
      players.push(p);
      emit('pw:moment', { kind: 'join', player: p });
    }
    const r = data.phase === 'free' ? 0.6 : data.phase === 'grace' ? 2 : rate(mins);
    if (playing && players.length > 3 && rnd() < r / 60) {
      const p = players[Math.floor(rnd() * players.length)], mach = MACHINES[Math.floor(rnd() * 6)];
      const rough = rnd() < 0.08;
      const value = Math.round((rough ? 2e4 + rnd() * 5e4 : 2e5 + rnd() * rnd() * 9e6) / 10) * 10;
      const s = { id: sid++, player_id: p.id, machine_id: mach.id, value, voided: false, free_play: data.phase !== 'on' && data.phase !== 'grace', created_at: new Date(now).toISOString() };
      scores.push(s);
      const tourney = !s.free_play;
      if (tourney && value > (tops.get(mach.id) || 0)) {
        tops.set(mach.id, value);
        tq.push({ kind: 'record', player: p, machine: mach, score: value });
      } else if (tourney && rnd() < 0.05) tq.push({ kind: 'leader', player: p });
      else gate?.('coin');
    }
    // Takeovers queue on the TV: the next one shows when the last is done (a clock card goes first).
    if (now >= takeoverUntil && tq.length && data.phase !== 'reveal') {
      const t = tq.shift();
      takeoverUntil = now + 7000;
      gate?.(t.kind);
      emit('pw:moment', { ...t, sealed: data.sealed });
    }
    await step(1000);
  };
  const until = async t => { while (Date.now() < t) await second(); };

  // Free play → start → the tournament (an outage of Gemini from 9:13 to 9:17: last call must still be said).
  await until(T0 + 60 * MIN);
  if (switchAt) { await until(T0 + switchAt.at * MIN); subs['audio/settings'](applyLevel({ ...host.state.settings }, switchAt.level)); }
  await until(END - 17 * MIN);
  net.down = true;
  await until(END - 13 * MIN);
  net.down = false;
  // A TV reload in the last 5 minutes (nothing replays).
  await until(END - 3.5 * MIN);
  tv.stopAudioHost(); await step(2000); host = tv.startAudioHost();
  await until(END + LOG_GRACE_MS + 30000);
  // The intermission ("the results are in").
  emit('pw:clock', { what: 'awards' });
  await until(END + 10 * MIN);

  // The reveal: intro + 12 prizes + the finale, Next every ~20 s, a Back at prize 5, a TV reload at prize 9.
  party.reveal_active = true; data.phase = 'reveal'; tq.length = 0;
  host.setReveal(true); // TvAudio's reveal prop
  const slides = [{ label: 'AWARDS CEREMONY', intro: true, hold: true }, { label: 'GRAND CHAMPION', title: 'FlyingGoat' }, { label: '2ND PLACE', title: 'Megs', walk: { rows: [1, 2, 3].map(() => ({})), win: 1 }, walkOnly: true }, { label: '3RD PLACE', title: 'Stacia', walk: { rows: [1, 2, 3, 4].map(() => ({})), win: 2 }, walkOnly: true },
    ...MACHINES.map((m, i) => ({ label: `${m.name.toUpperCase()} CHAMPION`, title: NAMES[i + 3], machine: { name: m.name }, walk: { rows: [1, 2, 3, 4, 5].map(() => ({})), win: i % 3 } })),
    { label: 'THE GRINDER', title: 'Tilt Tom', walk: { rows: [1, 2, 3].map(() => ({})), win: 0 } }, { label: 'THE BIG WHIFF', title: 'Drain-o' }, { label: 'THE MATCH', title: 'Spinner', spin: { drawn: 40, items: [1, 2, 3, 4].map(() => ({})) } }, { label: 'FINALE', finale: true, hold: true }];
  emit('pw:revealLines', { slides });
  const reveal = { plans: [] };
  const lead = () => host.leadMs();
  const showSlide = async (i, { back = false, initial = false } = {}) => {
    const sl = slides[i];
    const plan = soundPlan(sl, { instant: back || initial });
    const L = back || initial ? 0 : lead();
    reveal.plans.push({ at: Date.now(), i, n: plan.length, lead: L });
    emit('pw:reveal', { what: 'plan', step: i, label: sl.label, timeline: plan, lead: L });
    await step(L); // the picture follows the sounds by the Audio delay
    const at = back || initial ? 0 : showAt(sl);
    await step(at);
    emit('pw:reveal', { what: sl.intro ? 'intro' : sl.finale ? 'finale' : 'show', step: i, label: sl.label, slide: sl, back, initial });
    reveal[i] = Date.now();
  };
  for (let i = 0; i < slides.length; i++) {
    await showSlide(i);
    await step(14000);
    if (i === 5) { await showSlide(4, { back: true }); await step(5000); await showSlide(5); await step(10000); }
    if (i === 9) { tv.stopAudioHost(); await step(2500); reveal.reloadAt = Date.now(); host = tv.startAudioHost(); host.setReveal(true); await showSlide(9, { initial: true }); await step(8000); }
  }
  const revealEnd = Date.now();
  party.reveal_active = false; party.free_play = true; party.revealed_at = new Date().toISOString(); data.phase = 'free';
  host.setReveal(false);
  await step(4000);
  emit('pw:clock', { what: 'freeplay' });
  await until(Date.now() + 30 * MIN);
  party.status = 'closed';
  await until(Date.now() + 2 * MIN);
  const out = { log: [...log], marks, T0, END, revealStart: reveal[0] - 5000, revealEnd, reveal, requests: net.requests };
  tv.stopAudioHost(); await step(2000);
  return out;
}

// ---------- analysis ----------
function voices(log) {
  const out = [], open = new Map();
  for (const e of log) {
    if (e.kind !== 'voice') continue;
    if (e.ev === 'start') { const v = { tag: e.tag, start: e.t, end: e.t + (e.ms || 0), text: e.text }; out.push(v); open.set(e.tag + e.text, v); }
    if ((e.ev === 'end' || e.ev === 'cut') && open.has(e.tag + e.text)) { open.get(e.tag + e.text).end = Math.min(open.get(e.tag + e.text).end, e.t); open.delete(e.tag + e.text); }
  }
  return out;
}
const kindOf = tag => (tag?.startsWith('clock:') ? 'clock' : tag);

describe('the whole night, simulated', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-14T13:50:00-08:00'), toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    const store = new Map();
    vi.stubGlobal('localStorage', { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) });
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', hidden: false });
    vi.stubGlobal('fetch', fakeFetch);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const report = {};
  for (const level of ['full', 'chill', 'announcer', 'sfx']) {
    it(`${level}: keeps the rules all night`, async () => {
      const r = await runNight({ level });
      const v = voices(r.log);
      // 1. One voice at a time.
      for (let i = 1; i < v.length; i++) expect(v[i].start, `${v[i - 1].tag} → ${v[i].tag}`).toBeGreaterThanOrEqual(v[i - 1].end - 5);
      // 2. Nothing but the countdown line itself talks within a few seconds of a countdown moment.
      for (const m of r.marks) {
        const bad = v.filter(x => kindOf(x.tag) !== 'clock' && x.start < m.at + 9000 && x.end > m.at + 500);
        expect(bad.map(x => x.tag), `over the ${m.key} card`).toEqual([]);
      }
      // 3. The final 10 s (+ GAME OVER beep): silence but the boops / beep; the boops are 2 s ahead of the screen.
      // (played times: everything time-critical goes out 2 s early, so the window is END − 14 s … END − 0.4 s)
      const fin = v.filter(x => x.start < r.END - 400 && x.end > r.END - 14000);
      expect(fin.map(x => x.tag)).toEqual([]);
      const boops = r.log.filter(e => e.kind === 'sfx' && e.name === 'boop' && e.t > r.END - 60000 && e.t < r.END + 5000);
      expect(boops.map(b => b.n)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
      expect(boops[0].t).toBe(r.END - 10000 - 2000);
      const beep = r.log.find(e => e.kind === 'sfx' && e.name === 'endBeep' && e.t > r.END - 60000);
      expect(beep.t).toBe(r.END - 2000);
      // 4. During the reveal: only reveal lines; music at 0 the whole time, back up after.
      const inReveal = v.filter(x => x.start > r.revealStart && x.start < r.revealEnd);
      expect(inReveal.filter(x => x.tag !== 'reveal').map(x => x.tag)).toEqual([]);
      // (a reloaded TV's first level, before its reveal prop lands in the same tick, plays nothing: no player yet)
      const musicIn = r.log.filter(e => e.kind === 'music' && e.t > r.revealStart + 3000 && e.t < r.revealEnd && e.t !== r.reveal.reloadAt);
      expect(musicIn.filter(e => e.v !== 0).map(e => [e.t - r.revealStart, e.v])).toEqual([]);
      const after = r.log.filter(e => e.kind === 'music' && e.t > r.revealEnd).at(-1);
      expect(after.v).toBeCloseTo(0.6);
      // The winner lines: once each (the Back and the reload don't repeat them), cut when the next prize starts.
      if (level !== 'sfx') {
        const said = inReveal.map(x => x.text);
        // (prize 5 is said twice by design: Back then Next replays its build-up; the reload says nothing again)
        expect(said.length - new Set(said).size).toBe(1);
        expect(said.length).toBeGreaterThanOrEqual(13);
      } else expect(inReveal.length).toBe(0);
      // Reveal sounds: every prize's plan is scheduled 2 s ahead of its picture, none on Back / reload.
      expect(r.reveal.plans.filter(p => p.lead === 2000).length).toBe(15);
      expect(r.reveal.plans.filter(p => p.lead === 0).every(p => p.n === 0)).toBe(true);
      // 5. Sealed: nothing about the standings asked of the booth, said by the announcer, or in a one-liner.
      const sealFrom = r.END - 15 * 60000;
      for (const q of r.requests.filter(x => x.at >= sealFrom + 1000 && x.at < r.revealEnd && x.url.endsWith('/booth'))) {
        if (q.body.kind === 'quip') { expect(['top3', 'close']).not.toContain(q.body.moment); expect(q.body.facts.place).toBeUndefined(); expect(q.body.sealed).toBe(true); }
        else { expect(q.body.digest.sealed).toBe(true); expect(q.body.digest.leaders).toBeUndefined(); expect(q.body.digest.closeRace).toBeUndefined(); expect(JSON.stringify(q.body.digest.justHappened || [])).not.toMatch(/first place|overall/); }
      }
      expect(v.filter(x => x.start > sealFrom && x.tag === 'moment' && /lead|number one|top spot|first place|top dog/i.test(x.text)).map(x => x.text)).toEqual([]);
      // 6. The Gemini outage at last call: the countdown still spoke (the offline clip).
      if (level !== 'sfx') expect(v.some(x => x.tag === 'clock:end15')).toBe(true);
      // 7. After the GAME OVER card: the timesup line; the intermission: the awards line; after: free play.
      if (level !== 'sfx') for (const c of ['clock:start5', 'clock:on', 'clock:timesup', 'clock:awards', 'clock:freeplay']) expect(v.some(x => x.tag === c), c).toBe(true);
      // Chattiness: lines per 10 minutes, by phase.
      const per10 = (from, to, tags) => Math.round((v.filter(x => x.start >= from && x.start < to && (!tags || tags.includes(kindOf(x.tag)))).length / ((to - from) / 600000)) * 10) / 10;
      const span = [r.T0 + 5 * MIN, r.END - 15 * MIN];
      const air = (from, to) => Math.round(v.filter(x => x.start >= from && x.start < to).reduce((n, x) => n + (x.end - x.start), 0) / (to - from) * 1000) / 10;
      report[level] = {
        'all lines /10 min (tournament)': per10(...span),
        'booth bits': per10(...span, ['booth']), 'one-liners': per10(...span, ['quip']), 'announcer (records/#1/welcomes)': per10(...span, ['moment', 'welcome']),
        'countdown lines': per10(...span, ['clock']), 'talk time % (tournament)': air(...span),
        'busy hour /10 min': per10(r.T0 + 5 * MIN, r.T0 + 60 * MIN), 'quiet stretch /10 min': per10(r.T0 + 90 * MIN, r.T0 + 120 * MIN),
        'last call /10 min': per10(r.END - 15 * MIN, r.END), 'free play before /10 min': per10(r.T0 - 40 * MIN, r.T0 - 6 * MIN),
      };
    }, 120000);
  }

  it('switching levels mid-bit cuts correctly (Full → Effects only)', async () => {
    const r = await runNight({ level: 'full', switchAt: { at: 75, level: 'sfx' } });
    const v = voices(r.log);
    const at = r.T0 + 75 * MIN;
    expect(v.filter(x => x.start > at + 2000 && x.start < r.END + 600000 && kindOf(x.tag) !== 'reveal').map(x => x.tag)).toEqual([]);
    expect(v.filter(x => x.start < at && x.end > at + 1500).map(x => x.tag)).toEqual([]);
  }, 120000);

  it('prints the chattiness report', () => { console.log(JSON.stringify(report, null, 1)); expect(Object.keys(report).length).toBe(4); });
});
