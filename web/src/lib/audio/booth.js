// The announce booth: every few minutes, when the room is quiet, two hosts (DONNIE, the fun-center DJ
// voice, and DASH, the arcade play-by-play voice) talk about what's actually happening tonight and roast
// people gently over the PA. The `booth` edge function writes and voices each bit; this module decides
// what it's told (buildDigest), whether a bit is fit to play (safeLines), and when (BoothRunner).
// Pure: no React, no audio (tested in booth.test.js).
import { computeStandings, computeHighScores, MIN_TABLES } from '../scoring.js';
import { speakName, speakScore, speakMachine, numberWords } from './lines.js';

// The TV page registers where the booth reads tonight's data from (TV.jsx: scores, players, phase…).
let source = null;
export const setBoothSource = fn => { source = fn; };
export const boothSource = () => (source ? source() : null);

// A live moment as a plain fact for the hosts ("Big Dave set a new Fathom record: nine point two million").
export function momentFact(m) {
  const who = speakName(m?.player?.display_name), mach = speakMachine(m?.machine);
  if (m?.kind === 'record') return `${who} set a new ${mach} record: ${speakScore(m.score)}`;
  if (m?.kind === 'leader') return `${who} took over first place overall`;
  if (m?.kind === 'ranked') return `${who} got their first overall rating`;
  if (m?.kind === 'climb') return `${who} climbed ${numberWords(m.by || 1)} places in the overall standings`;
  if (m?.kind === 'shame') return `${who} dropped to the bottom of the overall standings`;
  if (m?.kind === 'milestone') return `the party hit ${numberWords(m.count)} games`;
  if (m?.kind === 'join') return `${who} just joined the party`;
  return null;
}

// ---------- the digest: a compact, speakable picture of the night ----------
const MIN = 60000;
const at = s => Date.parse(s?.created_at || '') || 0;

// mode: 'warmup' (free play before the start) | 'tournament' | 'lastcall' (last 15 min, results sealed)
// | 'freeplay' (after the awards) | null (no booth: logging grace, intermission, reveal, closed).
export function boothMode(phase, { lastCall = false } = {}) {
  if (phase === 'pre') return 'warmup';
  if (phase === 'on') return lastCall ? 'lastcall' : 'tournament';
  if (phase === 'free') return 'freeplay';
  return null;
}

export function buildDigest({ machines = [], players = [], scores = [], party = null, mode, sealed = false, now = Date.now(), events = [] }) {
  const playerById = new Map(players.map(p => [p.id, p]));
  const name = id => speakName(playerById.get(id)?.display_name);
  const mach = new Map(machines.map(m => [m.id, m]));
  const tourney = mode === 'tournament' || mode === 'lastcall';
  const pool = scores.filter(s => !s.voided && playerById.has(s.player_id) && (tourney ? !s.free_play : true));
  const st = computeStandings({ machines, players, scores: pool, includeFreePlay: !tourney });
  const d = {
    mode, sealed: !!sealed,
    players: players.length, gamesTonight: pool.length,
    gamesLast10Min: pool.filter(s => now - at(s) < 10 * MIN).length,
  };
  const ends = Date.parse(party?.tourney_ends_at || ''), starts = Date.parse(party?.tourney_starts_at || '');
  if (mode === 'warmup' && starts) d.minutesToStart = Math.max(0, Math.round((starts - now) / MIN));
  if (tourney && ends) d.minutesLeft = Math.max(0, Math.round((ends - now) / MIN));

  // Where a score lands on its machine tonight (1 = top), out of how many players.
  const placeOf = s => {
    const m = st.machines.find(x => x.machine.id === s.machine_id);
    if (!m) return null;
    const better = m.rows.filter(r => r.best > s.value).length;
    return { place: better + 1, of: Math.max(m.rows.length, better + 1) };
  };
  const bestBefore = s => pool.filter(x => x.player_id === s.player_id && x.machine_id === s.machine_id && x.id !== s.id && at(x) <= at(s))
    .reduce((b, x) => Math.max(b, x.value), -1);

  // The latest games (newest first).
  d.recent = pool.filter(s => now - at(s) < 15 * MIN).sort((a, b) => at(b) - at(a)).slice(0, 6).map(s => {
    const p = placeOf(s), prev = bestBefore(s);
    return {
      player: name(s.player_id), machine: speakMachine(mach.get(s.machine_id)), score: speakScore(s.value),
      minutesAgo: Math.max(0, Math.round((now - at(s)) / MIN)),
      ...(p ? { place: p.place, of: p.of } : {}),
      ...(prev >= 0 ? { personalBest: s.value > prev } : { firstTry: true }),
    };
  });

  // Each machine's top score tonight.
  const hs = computeHighScores({ machines, players, scores: pool, n: 2 });
  d.machineTops = hs.filter(m => m.top.length).map(m => ({
    machine: speakMachine(m.machine), player: speakName(m.top[0].player?.display_name), score: speakScore(m.top[0].score),
    ...(m.top[1] ? { runnerUp: speakName(m.top[1].player?.display_name), runnerUpScore: speakScore(m.top[1].score) } : {}),
  }));

  // Most games.
  const plays = new Map();
  for (const s of pool) plays.set(s.player_id, (plays.get(s.player_id) || 0) + 1);
  const most = [...plays].sort((a, b) => b[1] - a[1])[0];
  if (most && most[1] >= 3) d.mostGames = { player: name(most[0]), games: most[1] };

  // Hot: two or more top-3 games in the last 15 minutes. Cold: 3+ games in the last 30 minutes, all in
  // the bottom half of their machine.
  const lately = (mins) => pool.filter(s => now - at(s) < mins * MIN);
  const byPlayer = list => list.reduce((m, s) => m.set(s.player_id, [...(m.get(s.player_id) || []), s]), new Map());
  const hot = [...byPlayer(lately(15))].map(([id, ss]) => [id, ss.filter(s => (placeOf(s)?.place ?? 99) <= 3).length]).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
  if (hot) d.hotStreak = { player: name(hot[0]), topThreeGames: hot[1] };
  const cold = [...byPlayer(lately(30))].filter(([, ss]) => ss.length >= 3 && ss.every(s => { const p = placeOf(s); return p && p.of >= 4 && p.place > p.of / 2; }))[0];
  if (cold) d.coldStreak = { player: name(cold[0]), games: cold[1].length };

  // The roughest game of the night: last place on a machine with 4+ players, the furthest below the top.
  let worst = null;
  for (const m of st.machines) {
    if (m.rows.length < 4) continue;
    const last = m.rows[m.rows.length - 1], top = m.rows[0].best;
    const ratio = top ? last.best / top : 1;
    if (!worst || ratio < worst.ratio) worst = { ratio, player: name(last.playerId), machine: speakMachine(m.machine), score: speakScore(last.best), place: m.rows.length, of: m.rows.length };
  }
  if (worst && worst.ratio < 0.2) { const { ratio, ...w } = worst; void ratio; d.roughestGame = w; }

  // Standings (never while sealed, and only in the tournament).
  if (tourney && !sealed) {
    d.leaders = st.ranked.slice(0, 3).map((r, i) => ({ place: i + 1, player: speakName(r.player.display_name), rating: numberWords(r.rating) }));
    const [a, b] = st.ranked;
    if (a && b && a.rating - b.rating <= 2) d.closeRace = { leader: speakName(a.player.display_name), chaser: speakName(b.player.display_name), pointsApart: numberWords(a.rating - b.rating) };
  }
  if (events.length) d.justHappened = events.slice(-3);
  return d;
}

// ---------- safety: nothing unkind or unsuitable goes out over the PA ----------
// The nickname blocklist (migration 0040) plus words for teasing anything but pinball.
const SUBS = ['fuck', 'fvck', 'phuck', 'shit', 'cunt', 'bitch', 'nigg', 'whore', 'slut', 'porn', 'penis', 'vagina', 'nazi', 'hitler',
  'retard', 'twat', 'wank', 'jizz', 'faggot', 'dildo', 'asshole', 'pussy', 'motherf', 'bastard', 'blowjob', 'handjob', 'cumshot', 'molest'];
const WORDS = new Set(['ass', 'asses', 'cock', 'dick', 'dicks', 'cum', 'rape', 'fag', 'tit', 'tits', 'boob', 'boobs', 'sex', 'sexy', 'kkk', 'nude',
  'anal', 'anus', 'piss', 'arse', 'wtf', 'stfu', 'damn', 'hell', 'crap', 'sucks', 'stupid', 'dumb', 'idiot', 'moron', 'loser', 'losers',
  'fat', 'ugly', 'old', 'bald', 'drunk', 'beer', 'beers', 'booze', 'wasted', 'hate', 'kill', 'die', 'dead', 'pathetic', 'worthless',
  'lame', 'weird', 'gay', 'girly', 'wife', 'husband', 'girlfriend', 'boyfriend', 'divorce']);
// Light leetspeak inside words ("sh1t", "@ss"); "!" stays punctuation (spoken lines are full of it).
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's' };
export function unsafe(text) {
  const v = String(text || '').toLowerCase().replace(/[0134578@$]/g, c => LEET[c] || c);
  for (const t of v.split(/[^a-z]+/)) {
    if (!t) continue;
    const sq = t.replace(/(.)\1+/g, '$1');
    if (SUBS.some(w => t.includes(w) || sq.includes(w))) return true;
    if (WORDS.has(t) || WORDS.has(sq)) return true;
  }
  return false;
}
const SEALED = /\b(lead|leads|leader|leading|first place|second place|third place|number one|rank|ranked|ranking|rankings|rating|rated|podium|winning|frontrunner|top spot|in front|ahead)\b/i;
// A bit from the booth function, checked again here: 2-5 lines from the two hosts, short, clean, and
// (while sealed) nothing about the standings. Returns the lines, or null.
export function safeLines(lines, { sealed = false } = {}) {
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 5) return null;
  for (const l of lines) {
    if (!['DONNIE', 'DASH'].includes(l?.host) || typeof l.text !== 'string' || !l.text.trim() || l.text.length > 220) return null;
    if (unsafe(l.text) || (sealed && SEALED.test(l.text))) return null;
  }
  return lines;
}

// ---------- when ----------
export const BOOTH_GAP_MIN = { warmup: [7, 9], tournament: [6, 8], lastcall: [5, 6], freeplay: [9, 11] };
export const BOOTH_FREQ = { less: 1.6, normal: 1, more: 0.6 };
export const BOOTH = {
  firstAfter: 0.5,        // the first bit comes after half a gap
  prefetch: 90 * 1000,    // start making the next bit this long before it's due
  stale: 3 * MIN,         // a bit older than this is thrown away (the night has moved on)
  extraEvery: 4 * MIN,    // at most one extra bit after a juicy moment per this
  extraAfter: 60 * 1000,  // and it comes about this long after the moment
  quietGap: 20 * 1000,    // nothing else said or shown for this long first
  markBefore: 75 * 1000, markAfter: 25 * 1000, // and not this close to a countdown moment
};
export function boothGap(mode, freq = 'normal', rand = Math.random) {
  const [lo, hi] = BOOTH_GAP_MIN[mode] || BOOTH_GAP_MIN.tournament;
  return Math.round((lo + (hi - lo) * rand()) * MIN * (BOOTH_FREQ[freq] || 1));
}
// Is a countdown takeover / announcement due close to now? (start: 5…1 minutes before and the start;
// end: 15, 10, 5…1 minutes before and the end.)
export function nearMark(party, now = Date.now()) {
  const s = Date.parse(party?.tourney_starts_at || ''), e = Date.parse(party?.tourney_ends_at || '');
  const marks = [];
  if (s) for (const m of [5, 4, 3, 2, 1, 0]) marks.push(s - m * MIN);
  if (e) for (const m of [15, 10, 5, 4, 3, 2, 1, 0]) marks.push(e - m * MIN);
  return marks.some(t => now > t - BOOTH.markBefore && now < t + BOOTH.markAfter);
}
const JUICY = new Set(['record', 'leader', 'ranked', 'shame', 'climb']);

// The scheduler. deps:
//   now()                      clock
//   room()                     { mode, sealed, quiet: true when no takeover/voice/announcement for a bit,
//                                nearMark, digest() }
//   settings()                 { boothOn, boothFreq, boothRoast }
//   fetchBit(digest, settings) -> Promise<{ url, ms, lines }|null>
//   play(bit)                  -> true if it started (false: not now, try again soon)
export class BoothRunner {
  constructor({ now = () => Date.now(), room, settings, fetchBit, play, rand = Math.random }) {
    Object.assign(this, { now, room, settings, fetchBit, play, rand });
    this.nextAt = null; this.bit = null; this.inflight = null; this.lastExtra = -Infinity;
    this.events = []; this.log = []; this.mode = null; this.force = false;
  }
  gap(mode) { return boothGap(mode, this.settings().boothFreq, this.rand); }
  // A live moment on the TV (TV.jsx `pw:moment`): remembered for the next bit; a juicy one brings the
  // next bit forward (once per few minutes) and makes it fresh.
  event(m) {
    const t = this.now();
    if (m?.text) this.events = [...this.events.filter(e => t - e.t < 10 * MIN), { t, text: m.text }].slice(-5);
    if (!JUICY.has(m?.kind) || !this.settings().boothOn) return;
    if (t - this.lastExtra < BOOTH.extraEvery) return;
    this.lastExtra = t;
    const soon = t + BOOTH.extraAfter;
    if (this.nextAt == null || this.nextAt > soon) this.nextAt = soon;
    if (this.bit && this.bit.at < t) this.bit = null; // remake it with the news
  }
  playNow() { this.force = true; this.nextAt = this.now(); if (this.bit && this.now() - this.bit.at > 30000) this.bit = null; }
  async fetch(room) {
    if (this.inflight) return this.inflight;
    const t = this.now();
    const digest = { ...room.digest(), ...(this.events.length ? { justHappened: this.events.map(e => e.text) } : {}) };
    this.inflight = Promise.resolve(this.fetchBit(digest, this.settings(), this.log.slice(-4).flatMap(l => l.lines.map(x => x.text))))
      .then(b => {
        if (b && safeLines(b.lines, { sealed: room.sealed })) this.bit = { ...b, at: t, sealed: room.sealed };
        else this.failedAt = this.now();
      })
      .catch(() => { this.failedAt = this.now(); })
      .finally(() => { this.inflight = null; });
    return this.inflight;
  }
  tick() {
    const t = this.now(), s = this.settings(), room = this.room();
    if ((!s.boothOn && !this.force) || !room.mode) { this.nextAt = null; this.bit = null; this.mode = room.mode; return 'off'; }
    if (room.mode !== this.mode) { this.mode = room.mode; this.nextAt = null; this.bit = null; } // a new phase: start over
    if (this.nextAt == null) this.nextAt = t + Math.round(this.gap(room.mode) * BOOTH.firstAfter);
    if (this.force) this.nextAt = Math.min(this.nextAt, t);
    if (this.bit && (t - this.bit.at > BOOTH.stale || this.bit.sealed !== room.sealed)) this.bit = null;
    const failedLately = this.failedAt && t - this.failedAt < 30000;
    if (!this.bit && !this.inflight && !failedLately && t >= this.nextAt - BOOTH.prefetch) { this.fetch(room); return 'fetching'; }
    if (t < this.nextAt || !this.bit) return 'waiting';
    if (!this.force && (!room.quiet || room.nearMark)) return 'holding';
    const bit = this.bit;
    if (!this.play(bit)) return 'holding';
    this.bit = null; this.force = false; this.events = [];
    this.log = [...this.log, { at: t, lines: bit.lines, url: bit.url }].slice(-6);
    this.nextAt = t + (bit.ms || 15000) + this.gap(room.mode);
    return 'played';
  }
}
