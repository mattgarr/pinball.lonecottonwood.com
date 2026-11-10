// The audio director: ONE place that decides what the garage hears for each moment on the TV.
// Pure logic (no WebAudio, no Spotify): it is handed `out` (what it can do) and a clock, so the
// policy is unit tested (policy.test.js). The TV runtime (tv.js) wires `out` to the real things.
//
//   out.music(level, rampMs)   set the music volume (0..1, already master × duck), smoothly
//   out.pauseMusic()           pause the music (the reveal)          out.resumeMusic()
//   out.isPlaying()            was music playing (so the reveal only restores what it stopped)
//   out.sound(name, opts)      play one of the synth cues (synth.js)
//   out.voice(clip)            play an announcer clip; returns its length in ms (or 0 if none)
//   out.stopSounds()           cut every effect and voice now (emergency stop)
//   out.levels({ fx, voice })  effect / voice volumes (0..1)
//
// The cue policy (kept in sync with HANDOFF.md "Audio"):
//   ambient / normal      music at the host's level
//   small (score, toast)  the board's own short blip, never ducks, at most one per 0.4 s
//   medium (Wall of Shame) the sad trombone, music dips to 60% for 2.5 s
//   big (new leader, machine record, milestone, ranked)  the board's arcade sting = the attention
//                         tone; music ducks to 40% for ~2.6 s (0.25 s down, 1.2 s back up); 6 s
//                         cooldown: a second big moment inside it plays nothing (no stacking)
//   minute mark           a chime, then the announcer ("starts in five minutes"); music at 25%
//                         until the clip ends (+0.6 s). Voice off: chime + a big-moment duck.
//   tournament start      a fanfare, then "the tournament is on"; music at 25% meanwhile
//   final 10 seconds      music held at 12%; one boop per second, rising in pitch; a long
//                         BEEEP at zero, then "time's up, scores are locked", then music back up
//   winner reveal         music fades to silence (2.5 s) and pauses for the whole reveal; the
//                         reveal plays its own sounds (3-2-1 ticks, a ratchet per walk row, the
//                         Match roll and slot-reel clacks, a sting per winner, a bigger one for the
//                         Grand Champion); when the reveal ends, music resumes and fades up (3 s)
//   board sounds during the reveal or the final 10 s: muted
//   host: music / effects / voice volume, voice on/off, mute all, duck now, stop all audio

export const LEVELS = { big: 0.4, medium: 0.6, voice: 0.25, manual: 0.25, final: 0.12, reveal: 0 };
export const TIMING = {
  attack: 250, release: 1200,      // duck ramps (ms)
  bigHold: 2600, mediumHold: 2500, // how long a big / medium duck holds
  bigCooldown: 6000,               // no second big sting inside this
  smallGap: 400,                   // at most one small blip per this
  chimeLead: 900,                  // chime → voice
  fanfareLead: 1700,               // start fanfare → voice
  voiceTail: 600,                  // hold the duck this long after a clip
  finalSafety: 16000,              // the final-countdown duck never sticks longer than this
  beepLead: 1000,                  // after the "1" boop: the end BEEEP
  beepLen: 1600,                   // then the voice
  revealFade: 2500, revealRestore: 3000,
  manualHold: 8000,
};

// The board's chiptune effects (lib/chiptune.js `sfx.*`) by weight.
export const SFX_CLASS = {
  coin: 'small', climb: 'small', join: 'small',
  shame: 'medium',
  record: 'big', leader: 'big', milestone: 'big',
};

// Announcer clip for a clock moment (`pw:clock` detail from TV.jsx), or null.
export function clockClip(d) {
  if (!d) return null;
  if (d.what === 'mark') {
    const m = Number(d.minutes);
    if (d.side === 'start' && m >= 1 && m <= 5) return `start${m}`;
    if (d.side === 'end' && [15, 10, 5, 4, 3, 2, 1].includes(m)) return `end${m}`;
    return null;
  }
  if (d.what === 'start') return 'on';
  if (d.what === 'end') return 'timesup';
  return null;
}

// Reveal winner sting for a slide.
export function stingFor(slide) {
  if (!slide) return 'sting';
  if (slide.empty) return 'noWinner';
  if (slide.grand) return 'grandSting';
  if (slide.whiff) return 'whiff';
  if (slide.intro) return 'introSting';
  if (slide.finale) return 'finaleSting';
  return 'sting';
}

// The reveal's own events (Reveal.jsx dispatches window `pw:reveal`: { what, n, label, empty, back })
// → the sound for that moment. Walk rows, the Match roll and reel clacks follow the screen instead
// (components/TvAudio.jsx watches the reveal's DOM), so their timing always matches what you see.
export function revealEventCue(d) {
  if (!d) return null;
  if (d.what === 'count') return 'tick';
  if (d.back) return null; // going Back shows the winner again without a fanfare
  if (d.what === 'intro') return 'introSting';
  if (d.what === 'finale') return 'finaleSting';
  if (d.what !== 'show') return null;
  const label = String(d.label || '').toUpperCase();
  return stingFor({ empty: !!d.empty, grand: label === 'GRAND CHAMPION', whiff: label === 'THE BIG WHIFF' });
}

export const DEFAULT_SETTINGS = {
  musicVol: 0.6, fxVol: 0.8, voiceVol: 1, voiceOn: true, muteAll: false, pack: 'british',
};

export class AudioDirector {
  constructor({ out, now = () => Date.now(), setT = (f, ms) => setTimeout(f, ms), clearT = t => clearTimeout(t), settings = {} } = {}) {
    this.out = out;
    this.now = now;
    this.setT = setT;
    this.clearT = clearT;
    this.s = { ...DEFAULT_SETTINGS, ...settings };
    this.holds = new Map(); // name -> { level, until }
    this.holdTimer = null;
    this.lastBig = -Infinity;
    this.lastSmall = -Infinity;
    this.reveal = false;
    this.resumeAfterReveal = false;
    this.final = false;
    this.beeped = false;
    this.timers = { clock: [], reveal: [], final: [] };
    this.level = null; // last music level sent
    this.log = [];
  }

  // ---------- music level ----------
  duckFactor() {
    const t = this.now();
    let f = 1;
    for (const h of this.holds.values()) if (h.until > t) f = Math.min(f, h.level);
    return f;
  }
  target() { return this.s.muteAll ? 0 : this.s.musicVol * this.duckFactor(); }
  apply(ramp = TIMING.attack) {
    const t = this.now();
    for (const [k, h] of this.holds) if (h.until <= t) this.holds.delete(k);
    const v = Math.round(this.target() * 1000) / 1000;
    if (v !== this.level) {
      // Going down is quick (the attack); coming back up is the slower release.
      const r = this.level != null && v > this.level ? Math.max(ramp, TIMING.release) : ramp;
      this.level = v;
      this.out.music?.(v, r);
    }
    // Wake up when the next hold runs out.
    if (this.holdTimer) this.clearT(this.holdTimer);
    this.holdTimer = null;
    let next = Infinity;
    for (const h of this.holds.values()) if (h.until < next) next = h.until;
    if (next < Infinity) this.holdTimer = this.setT(() => this.apply(TIMING.release), Math.max(0, next - t));
  }
  hold(name, level, ms) {
    this.holds.set(name, { level, until: ms === Infinity ? Infinity : this.now() + ms });
    this.apply(TIMING.attack);
  }
  unhold(name, ramp = TIMING.release) {
    if (!this.holds.delete(name)) return;
    this.apply(ramp);
  }

  // ---------- settings / host ----------
  setSettings(patch = {}) {
    this.s = { ...this.s, ...patch };
    this.out.levels?.({ fx: this.s.muteAll ? 0 : this.s.fxVol, voice: this.s.muteAll ? 0 : this.s.voiceVol });
    this.apply(600);
  }
  duckNow(ms = TIMING.manualHold) { this.hold('manual', LEVELS.manual, ms); }
  stopAll() {
    this.clearAll();
    this.out.stopSounds?.();
    this.setSettings({ muteAll: true });
    this.out.pauseMusic?.();
  }

  quiet() { return this.s.muteAll || this.reveal || this.final; }

  // ---------- board moments (the chiptune gate) ----------
  // Called before each board sound effect; false = don't play it.
  gate(name) {
    if (this.quiet()) return false;
    const t = this.now();
    const cls = SFX_CLASS[name] || 'small';
    if (cls === 'small') {
      if (t - this.lastSmall < TIMING.smallGap) return false;
      this.lastSmall = t;
      return true;
    }
    if (cls === 'medium') {
      this.hold('medium', LEVELS.medium, TIMING.mediumHold);
      return true;
    }
    if (t - this.lastBig < TIMING.bigCooldown) return false; // no stacking
    this.lastBig = t;
    this.hold('big', LEVELS.big, TIMING.bigHold);
    return true;
  }

  // A big moment with the director's own attention tone (host test button, or any caller that
  // has no board sound of its own).
  bigMoment() {
    if (this.quiet()) return false;
    const t = this.now();
    if (t - this.lastBig < TIMING.bigCooldown) return false;
    this.lastBig = t;
    this.hold('big', LEVELS.big, TIMING.bigHold);
    this.out.sound?.('attention');
    return true;
  }
  small() {
    if (this.quiet()) return false;
    const t = this.now();
    if (t - this.lastSmall < TIMING.smallGap) return false;
    this.lastSmall = t;
    this.out.sound?.('blip');
    return true;
  }

  // ---------- announcements ----------
  // Play `clip` after `lead` ms, with the music at the voice level until it ends.
  announce(clip, { lead = 0, pre = null, group = 'clock' } = {}) {
    if (this.s.muteAll) return;
    if (pre) this.out.sound?.(pre);
    const voiceOn = this.s.voiceOn && clip;
    if (!voiceOn) {
      if (pre) this.hold('big', LEVELS.big, TIMING.bigHold);
      return;
    }
    this.hold('voice', LEVELS.voice, lead + 8000); // generous until we know the clip's length
    this.later(group, lead, () => {
      const ms = this.out.voice?.(clip) || 0;
      this.hold('voice', LEVELS.voice, (ms || 2500) + TIMING.voiceTail);
    });
  }

  // A tournament clock moment from the TV (`pw:clock`).
  clock(d) {
    if (!d || this.s.muteAll) return;
    if (d.what === 'tick') return this.tick(Number(d.n));
    if (this.reveal) return;
    const clip = clockClip(d);
    if (d.what === 'mark') return this.announce(clip, { lead: TIMING.chimeLead, pre: 'chime' });
    if (d.what === 'start') return this.announce(clip, { lead: TIMING.fanfareLead, pre: 'fanfare' });
    if (d.what === 'end') {
      // The BEEEP plays once: from the countdown (after "1") or here if the countdown was missed.
      const lead = this.beeped ? 0 : TIMING.beepLen;
      if (!this.beeped) this.endBeep();
      this.clear('final');
      this.final = false;
      this.unhold('final', 0);
      this.announce(clip, { lead, group: 'final' });
      this.later('reset', 60000, () => { this.beeped = false; });
    }
  }

  // The final 10-second countdown: n = 10 … 1.
  tick(n) {
    if (this.s.muteAll || this.reveal || !(n >= 1 && n <= 10)) return;
    if (!this.final) { this.final = true; this.beeped = false; }
    this.hold('final', LEVELS.final, TIMING.finalSafety);
    this.out.sound?.('boop', { n });
    this.clear('final');
    if (n === 1) this.later('final', TIMING.beepLead, () => this.endBeep());
    // If the end card never comes (e.g. the host changed the schedule), let go after a while.
    this.later('final', TIMING.finalSafety, () => { this.final = false; this.unhold('final'); });
  }
  endBeep() {
    if (this.beeped) return;
    this.beeped = true;
    this.out.sound?.('endBeep');
  }

  // ---------- the winner reveal ----------
  revealStart() {
    if (this.reveal) return;
    this.reveal = true;
    this.clear('clock');
    this.clear('final');
    this.final = false;
    this.holds.delete('final');
    this.resumeAfterReveal = this.out.isPlaying ? !!this.out.isPlaying() : true;
    this.holds.set('reveal', { level: LEVELS.reveal, until: Infinity });
    this.level = 0;
    this.out.music?.(0, TIMING.revealFade);
    this.later('reveal', TIMING.revealFade + 100, () => { if (this.reveal) this.out.pauseMusic?.(); });
  }
  revealEnd() {
    if (!this.reveal) return;
    this.reveal = false;
    this.clear('reveal');
    this.holds.delete('reveal');
    if (this.resumeAfterReveal && !this.s.muteAll) {
      this.out.music?.(0, 0);
      this.out.resumeMusic?.();
    }
    this.level = 0;
    this.apply(TIMING.revealRestore);
  }
  // One reveal sound as it happens on screen (a 3-2-1 tick, a walk row, a reel clack, a sting…).
  revealCue(name, opts) {
    this.revealStart();
    if (this.s.muteAll || !name) return false;
    this.out.sound?.(name, opts);
    return true;
  }
  // A whole timeline of reveal sounds at once (host test buttons); a new one cancels the last.
  revealSlide(tl) {
    if (!tl) return;
    this.revealStart();
    this.clear('reveal');
    if (this.s.muteAll) return;
    for (const e of tl.events || []) this.later('reveal', e.at, () => this.out.sound?.(e.s, e));
    if (tl.show != null) this.later('reveal', tl.show, () => this.out.sound?.(stingFor(tl)));
  }

  // ---------- timers ----------
  later(group, ms, fn) {
    const list = (this.timers[group] ||= []);
    const id = this.setT(() => { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); fn(); }, ms);
    list.push(id);
    return id;
  }
  clear(group) {
    for (const id of this.timers[group] || []) this.clearT(id);
    this.timers[group] = [];
  }
  clearAll() {
    for (const g of Object.keys(this.timers)) this.clear(g);
    this.holds.clear();
    this.final = false;
  }
  destroy() {
    this.clearAll();
    if (this.holdTimer) this.clearT(this.holdTimer);
  }
}
