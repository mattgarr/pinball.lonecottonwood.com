// The TV's audio host: the ONLY page that plays sound (the Mac running /tv, its output sent to the
// WiiM over AirPlay). It wires the director (policy.js) to the real outputs:
//   music   Spotify: the Web Playback SDK inside this page (default), or another Spotify device
//           (the Spotify app on the Mac, or the WiiM over Spotify Connect) through the Web API
//   effects the synth cues (synth.js) and the board's chiptune (chiptune.js), one effects bus
//   voice   the announcer clips (voice.js)
// and listens to the TV: `pw:clock` (TV.jsx tournament clock), `pw:reveal` (Reveal.jsx), the
// board's sound effects (chiptune gate), host commands over MQTT (<channel>/audio/cmd) and the
// host's settings (<channel>/audio/settings, retained; cached here so a reload keeps them).
// It reports to the host card on <channel>/audio/state (retained) and <channel>/audio/lists.
import { AudioDirector, DEFAULT_SETTINGS, TIMING } from './policy.js';
import { playSound, stopSounds } from './synth.js';
import { BOOTH_URL, DEFAULT_PACK, PRIO, auth, cutVoices, loadManifest, post, preloadPack, prewarm, say, sayClip, setSayNames, setVoiceListener, setVoiceVolume, stopVoice, voiceBusy, voiceQuietFor } from './voice.js';
import { DEFAULT_DELAY, browserLatency, effectiveDelay, measureWithMic } from './sync.js';
import { serverNow } from '../clock.js';
import { BOOTH, BoothRunner, QUIP, QuipThrottle, boothDuo, boothMode, boothSource, buildDigest, momentFact, nearMark, quipFor, quipHost, safeQuip } from './booth.js';
import { clockText, momentText, revealText } from './lines.js';
import * as sp from './spotify.js';
import { audioCtx, ensureCtx, fxBus, setGate, sound } from '../chiptune.js';
import { publish, subscribe } from '../lights/mqtt.js';

const SETTINGS_KEY = 'pw.audioSettings';
const CMD_FRESH_MS = 30000;
export const AUDIO_DEFAULTS = {
  ...DEFAULT_SETTINGS,
  pack: DEFAULT_PACK, playlist: '', playlistName: '', clientId: '', output: 'tv', outputName: '',
  autoplay: true, shuffle: true, sayNames: '',
  // The announce booth (DONNIE + DASH): on/off, how often ('less' | 'normal' | 'more'), roast ('gentle' | 'spicy').
  boothOn: true, boothFreq: 'normal', boothRoast: 'gentle', boothShort: false, boothExtras: true,
  // The booth's two hosts (any two announcer voices). Matt's pick: Tiffani (valley girl) + Donnie (fun-center DJ).
  boothA: 'valley', boothB: 'dj',
  // Audio delay (s): time-critical sounds play this much EARLIER than the screen (AirPlay to the WiiM buffers
  // ~2 s). 'auto' uses what the Mac reports when it's plausible, else audioDelay; 'manual' (or a mic sync,
  // delaySource 'mic') uses audioDelay.
  audioDelay: DEFAULT_DELAY, delayMode: 'auto', delaySource: '',
};

const readSettings = () => { try { return { ...AUDIO_DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || {}) }; } catch { return { ...AUDIO_DEFAULTS }; } };
const saveSettings = s => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private window */ } };

let rt = null;      // the running host
let refs = 0;
let stopTimer = null;
const listeners = new Set();

// How far ahead of the picture the reveal's sounds run (ms); 0 when the TV isn't playing sound.
export const audioLeadMs = () => rt?.leadMs?.() || 0;

// The audit log (debugging + rehearsals): every effect, voice line, music level and clock / reveal moment,
// newest last. window.__pwAudioLog on the TV.
const AUDIT_MAX = 5000; // about a whole night
const audit = [];
export const auditLog = () => audit;
function note(kind, data = {}) {
  audit.push({ t: Date.now(), kind, ...data });
  if (audit.length > AUDIT_MAX) audit.splice(0, audit.length - AUDIT_MAX);
}
try { window.__pwAudioLog = audit; } catch { /* no window */ }

export function onAudioState(fn) { listeners.add(fn); if (rt) fn(rt.state); return () => listeners.delete(fn); }
export const audioState = () => rt?.state || null;

// Start (or keep) the TV audio host. Safe to call from several components; stopAudioHost undoes it.
export function startAudioHost() {
  refs++;
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  if (!rt) rt = createHost();
  try { window.__pwAudio = rt; } catch { /* ignore */ } // for debugging from the console
  return rt;
}
export function stopAudioHost() {
  refs = Math.max(0, refs - 1);
  if (refs || !rt) return;
  // Deferred: the TV swaps between the board and the reveal (unmount + mount in one go).
  stopTimer = setTimeout(() => { if (!refs && rt) { rt.destroy(); rt = null; } }, 1500);
}

function createHost() {
  let settings = readSettings();
  let player = null, deviceId = null;
  let sdkState = null; // last SDK player state
  let remote = null;   // last Web API /me/player (device mode)
  let wantPlaying = false;
  let autoplayBlocked = false;
  const soundPref = () => { try { return localStorage.getItem('pw.tvsound'); } catch { return null; } };
  let destroyed = false;
  const offs = [];
  // Audio delay state (see "audio delay" below).
  let browserLat = null; // what the Mac reports for the output (s), or null
  const delay = () => effectiveDelay(settings, browserLat);
  let finalSched = false; // the final seconds are scheduled from the end time (not the screen's ticks)
  let syncing = false;    // a mic sync is listening
  const state = {
    page: 'tv', at: Date.now(), unlocked: false, sound: sound.wanted(),
    spotify: { login: sp.hasLogin(), ready: false, playing: false, track: '', artist: '', context: '', device: '', error: '' },
    level: 0, reveal: false, final: false, settings, notice: '', booth: null,
  };

  // ---------- state out ----------
  let pubTimer = null;
  const emit = () => {
    state.at = Date.now();
    state.unlocked = audioCtx()?.state === 'running';
    state.sound = sound.isOn();
    state.reveal = director.reveal;
    state.final = director.final;
    state.settings = settings;
    state.delay = delay();
    state.spotify.login = sp.hasLogin();
    // The banner: the browser still blocks sound (unless the effects were switched off on purpose),
    // or Spotify's player couldn't start by itself.
    state.needsClick = (soundPref() !== '0' && (!state.unlocked || !state.sound)) || autoplayBlocked;
    for (const fn of listeners) { try { fn({ ...state }); } catch { /* ignore */ } }
    if (!pubTimer) pubTimer = setTimeout(() => { pubTimer = null; publish('audio/state', { ...state, notice: undefined }, { retain: true }); }, 800);
  };
  const setSp = patch => { Object.assign(state.spotify, patch); emit(); };
  const notice = (msg, ms = 8000) => { state.notice = msg; emit(); setTimeout(() => { if (state.notice === msg) { state.notice = ''; emit(); } }, ms); };

  // ---------- music ----------
  const deviceMode = () => settings.output && settings.output !== 'tv';
  let cur = 0, ramp = null, sendTimer = null, lastSent = 0, pending = null;
  const music = {
    setLevel(v, ms = 300) {
      state.level = v;
      if (ramp) { clearInterval(ramp); ramp = null; }
      if (deviceMode()) return this.sendRemote(v);
      if (!player) { cur = v; return; }
      const from = cur, t0 = performance.now();
      if (!ms) { cur = v; player.setVolume(Math.max(0, v)).catch(() => {}); return; }
      ramp = setInterval(() => {
        const x = Math.min(1, (performance.now() - t0) / ms);
        cur = from + (v - from) * x;
        player?.setVolume(Math.max(0, cur)).catch(() => {});
        if (x >= 1) { clearInterval(ramp); ramp = null; }
      }, 50);
    },
    // Web API volume: rate limited, so at most one call per 0.6 s (the last value always lands).
    sendRemote(v) {
      pending = Math.round(Math.max(0, Math.min(1, v)) * 100);
      const go = () => {
        sendTimer = null; lastSent = Date.now();
        const p = pending; pending = null;
        sp.api('PUT', `/me/player/volume?volume_percent=${p}&device_id=${encodeURIComponent(settings.output)}`).catch(e => {
          if (e.status === 429 && !sendTimer) { pending ??= p; sendTimer = setTimeout(go, (e.retryAfter || 2) * 1000); }
        });
      };
      if (!sendTimer) sendTimer = setTimeout(go, Math.max(0, 600 - (Date.now() - lastSent)));
    },
    isPlaying() { return deviceMode() ? !!remote?.is_playing : !!(sdkState && !sdkState.paused); },
    async pause() {
      wantPlaying = false;
      if (deviceMode()) await sp.api('PUT', `/me/player/pause?device_id=${encodeURIComponent(settings.output)}`).catch(() => {});
      else await player?.pause().catch(() => {});
    },
    async resume() {
      wantPlaying = true;
      if (deviceMode()) return this.start();
      if (sdkState) await player?.resume().catch(() => {});
      else await this.start();
    },
    async next() {
      if (deviceMode()) await sp.api('POST', `/me/player/next?device_id=${encodeURIComponent(settings.output)}`).catch(() => {});
      else await player?.nextTrack().catch(() => {});
    },
    async prev() {
      if (deviceMode()) await sp.api('POST', `/me/player/previous?device_id=${encodeURIComponent(settings.output)}`).catch(() => {});
      else await player?.previousTrack().catch(() => {});
    },
    // Play the chosen playlist on the chosen output. Resumes where it left off if that playlist
    // was already the one playing (a TV reload doesn't restart it from the top).
    async start({ restart = false } = {}) {
      if (!sp.hasLogin()) return;
      const dev = deviceMode() ? settings.output : deviceId;
      if (!dev) return; // the SDK isn't ready yet: it starts us when it is
      wantPlaying = true;
      try {
        const now = await sp.api('GET', '/me/player').catch(() => null);
        if (settings.shuffle) await sp.api('PUT', `/me/player/shuffle?state=true&device_id=${encodeURIComponent(dev)}`).catch(() => {});
        const same = now?.context?.uri && now.context.uri === settings.playlist;
        // A brand-new browser player can take a moment to be known to Spotify: one retry on 404.
        const retry = async f => { try { return await f(); } catch (e) { if (e.status !== 404) throw e; await new Promise(r => setTimeout(r, 1500)); return f(); } };
        if (settings.playlist && (restart || !same)) {
          await retry(() => sp.api('PUT', `/me/player/play?device_id=${encodeURIComponent(dev)}`, { context_uri: settings.playlist }));
        } else if (now?.device?.id !== dev || !now?.is_playing) {
          await retry(() => sp.api('PUT', '/me/player', { device_ids: [dev], play: true }));
        }
        music.setLevel(director.target(), 0);
        setSp({ error: '' });
      } catch (e) {
        setSp({ error: e.status === 404 ? 'Spotify device not found (open the Spotify app / wake the WiiM, then refresh)' : e.status === 403 ? 'Spotify refused playback (Premium needed?)' : e.message });
      }
    },
  };

  // ---------- the director ----------
  const director = new AudioDirector({
    settings,
    out: {
      music: (v, ms) => { note('music', { v, ms }); music.setLevel(v, ms); emit(); },
      pauseMusic: () => { if (music.isPlaying()) { const was = wantPlaying; music.pause(); wantPlaying = was; } },
      resumeMusic: () => { if (wantPlaying || settings.autoplay) music.resume(); },
      isPlaying: () => music.isPlaying() || wantPlaying,
      sound: (name, opts) => { note('sfx', { name, n: opts?.n }); return playSound(name, opts); },
      voice: clip => (settings.voiceOn && settings.sayClock !== false ? sayClip(voicePack(), clip) : 0),
      // A booth bit ({ url }) plays with the neutral chain; { pack, text } in that voice; plain text in the announcer's voice.
      // tag: booth / quip (chatter: a countdown line cuts it off), moment / welcome / say, reveal.
      say: (item, { tag = 'line', reveal = false } = {}) => {
        if (!settings.voiceOn) return 0;
        const prio = reveal ? PRIO.reveal : ['booth', 'quip'].includes(tag) ? PRIO.chat : PRIO.live;
        const o = { prio, tag };
        return item?.url ? say('booth', item, o) : item?.text ? say(item.pack, item.text, o) : say(voicePack(), item, o);
      },
      // The last 10 seconds and the reveal: nothing from before keeps talking (or waits to).
      hush: why => { note('hush', { why }); cutVoices(PRIO.reveal); if (boothPlaying) { boothPlaying = null; setTimeout(emitBooth, 0); } },
      stopSounds: () => { stopSounds(); stopVoice(); },
      levels: ({ fx, voice }) => {
        const c = audioCtx(), b = fxBus();
        if (c && b) b.gain.setTargetAtTime(fx, c.currentTime, 0.05);
        setVoiceVolume(voice);
      },
    },
  });
  const origSetSettings = director.setSettings.bind(director);
  setVoiceListener(e => note('voice', e));
  setGate(name => director.gate(name));

  let boothPlaying = null; // the booth bit on air (the level control can cut it off)
  // Who speaks the announcer lines: with the booth on (Full / Chill), the booth duo (alternating, so the night has one
  // consistent pair); otherwise (Announcer level) the chosen announcer voice.
  const boothActive = () => settings.boothOn !== false && settings.voiceOn !== false;
  let voiceTurn = 0;
  function voicePack(slot) {
    if (!boothActive()) return settings.pack || DEFAULT_PACK;
    const duo = boothDuo(settings);
    return duo[(slot ?? voiceTurn++) % 2];
  }
  const voicePacks = () => (boothActive() ? boothDuo(settings) : [settings.pack || DEFAULT_PACK]);
  function applySettings(next, { fromHost = false } = {}) {
    const prev = settings;
    settings = { ...AUDIO_DEFAULTS, ...next };
    saveSettings(settings);
    setSayNames(settings.sayNames);
    origSetSettings({ musicVol: settings.musicVol, fxVol: settings.fxVol, voiceVol: settings.voiceVol, voiceOn: settings.voiceOn, muteAll: settings.muteAll, pack: settings.pack,
      sayClock: settings.sayClock, sayRecords: settings.sayRecords, sayJoins: settings.sayJoins, sayReveal: settings.sayReveal });
    if ((settings.pack !== prev.pack || settings.boothA !== prev.boothA || settings.boothB !== prev.boothB || settings.boothOn !== prev.boothOn) && state.unlocked) voicePacks().forEach(preloadPack);
    // Turning the voices (or the booth) down cuts off whatever is being said right now.
    if (fromHost && prev.voiceOn !== false && settings.voiceOn === false) { stopVoice(); boothPlaying = null; emitBooth(); }
    else if (fromHost && boothPlaying && (settings.boothOn === false || (settings.boothShort && !prev.boothShort))) { stopVoice(); boothPlaying = null; emitBooth(); }
    if (fromHost) {
      if (prev.muteAll && !settings.muteAll && !director.reveal) music.resume();
      const outChanged = settings.output !== prev.output;
      if (outChanged) {
        if (deviceMode()) player?.pause().catch(() => {});
        if (state.unlocked && wantPlaying) music.start({ restart: false });
        pollRemote();
      }
      if ((settings.clientId || '') !== (prev.clientId || '') && sp.hasLogin()) notice('New Spotify Client ID: press Connect Spotify again');
    }
    emit();
  }
  applySettings(settings);

  // ---------- unlock (browsers need one click before sound) ----------
  async function unlock() {
    autoplayBlocked = false;
    ensureCtx();
    if (!sound.isOn()) await sound.enable({ quiet: true });
    else await audioCtx()?.resume().catch(() => {});
    try { player?.activateElement?.(); } catch { /* older SDK */ }
    applySettings(settings);
    voicePacks().forEach(preloadPack);
    emit();
    if (settings.autoplay && !settings.muteAll && !director.reveal && !music.isPlaying()) music.start();
  }
  // Any click / key on the TV unlocks (except the TV's own sound on/off button, which decides itself,
  // and not if someone switched the effects off there on purpose).
  const onPointer = e => {
    try { player?.activateElement?.(); } catch { /* ignore */ }
    if (e?.target?.closest?.('.tv-sound')) return;
    if (soundPref() === '0') { if (autoplayBlocked) { autoplayBlocked = false; music.start(); } return; }
    if (audioCtx()?.state !== 'running' || !sound.isOn() || autoplayBlocked) unlock();
  };
  window.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('keydown', onPointer, true);
  offs.push(() => { window.removeEventListener('pointerdown', onPointer, true); window.removeEventListener('keydown', onPointer, true); });
  const onSound = e => { if (e.detail?.on) { applySettings(settings); voicePacks().forEach(preloadPack); } emit(); };
  window.addEventListener('pw:sound', onSound);
  offs.push(() => window.removeEventListener('pw:sound', onSound));
  const onVis = () => { if (document.visibilityState === 'visible') setTimeout(emit, 500); };
  document.addEventListener('visibilitychange', onVis);
  offs.push(() => document.removeEventListener('visibilitychange', onVis));

  // ---------- the TV's moments ----------
  const onClock = e => {
    note('clock', { ...e.detail });
    if (e.detail?.what === 'tick' && finalSched) return; // the final seconds are scheduled ahead (Audio delay)
    director.clock(e.detail); emit();
  };
  let lastRevealStep = null;
  const onReveal = e => {
    const d = e.detail || {};
    note('reveal', { what: d.what, step: d.step, label: d.label, n: d.n, back: d.back, initial: d.initial, lead: d.lead, sounds: d.timeline?.length });
    // The slide's sounds come as one plan, scheduled from its timeline (ahead of the picture by the Audio delay).
    if (d.what === 'plan') { director.revealSlide({ events: d.timeline || [] }); emit(); return; }
    director.revealStart();
    // A new prize on screen: whatever the announcer was still saying about the last one stops.
    if (e.detail?.step != null && e.detail.step !== lastRevealStep) { if (lastRevealStep != null) stopVoice(); lastRevealStep = e.detail.step; }
    onRevealSay(e.detail);
    emit();
  };
  window.addEventListener('pw:clock', onClock);
  window.addEventListener('pw:reveal', onReveal);
  offs.push(() => { window.removeEventListener('pw:clock', onClock); window.removeEventListener('pw:reveal', onReveal); });

  // ---------- the announcer's live lines ----------
  // Each announcer line in the voice of whoever's turn it is (see voicePack).
  const line = (fn) => { const p = voicePack(); const text = fn(p); return text ? { pack: p, text } : null; };
  // A takeover or toast on the TV (TV.jsx `pw:moment`): records, a new #1, someone ranked, a games
  // milestone, people joining. While results are sealed (last 15 min until the reveal) nothing about
  // the standings is said.
  let joins = [], joinTimer = null, lastWelcome = 0, lastMoment = 0;
  // At most one welcome per 45 s (names gathered: "Ann, Bob and two more"), so a busy door doesn't mean nonstop talk.
  const WELCOME_GAP = 45000, JOIN_GATHER = 3000;
  const flushJoins = () => {
    joinTimer = null;
    const ps = joins; joins = [];
    if (!ps.length || settings.sayJoins === false) return;
    lastWelcome = Date.now();
    const l = line(p => momentText(p, { kind: 'join', players: ps }));
    if (l) director.speak(l, { lead: 600, tag: 'welcome' });
  };
  const onMoment = e => {
    const m = e.detail;
    lastMoment = Date.now();
    if (m?.kind) booth.event({ kind: m.kind, text: m.sealed && ['leader', 'ranked', 'climb', 'shame'].includes(m.kind) ? null : momentFact(m) });
    note('moment', { k: m?.kind, sealed: !!m?.sealed });
    if (!m?.kind || settings.muteAll || !settings.voiceOn) return;
    if (m.kind === 'join') {
      if (settings.sayJoins === false || !m.player) return;
      if (!joins.some(p => p.id === m.player.id)) joins.push(m.player);
      if (!joinTimer) joinTimer = setTimeout(flushJoins, Math.max(JOIN_GATHER, lastWelcome + WELCOME_GAP - Date.now()));
      return;
    }
    if (settings.sayRecords === false) return;
    if (m.sealed && ['leader', 'ranked', 'climb'].includes(m.kind)) return;
    if (!['record', 'leader', 'ranked', 'milestone'].includes(m.kind)) return;
    // After the board's own sting (about a second and a half in).
    const l = line(p => momentText(p, m));
    if (l) director.speak(l, { lead: 1500, tag: 'moment' });
  };
  window.addEventListener('pw:moment', onMoment);
  offs.push(() => { window.removeEventListener('pw:moment', onMoment); clearTimeout(joinTimer); });

  // The reveal: Reveal.jsx sends every slide's words ahead of time (`pw:revealLines`) so they're ready
  // when the winner lands, then each winner as it shows. A TV reload doesn't say a winner twice.
  const SPOKEN_KEY = 'pw.revealSpoken';
  const spoken = () => { try { return JSON.parse(localStorage.getItem(SPOKEN_KEY) || '{}'); } catch { return {}; } };
  const onRevealLines = e => {
    const slides = e.detail?.slides || [];
    if (!settings.voiceOn || settings.sayReveal === false) return;
    // Each slide in a fixed voice (by its position), so the prewarmed line is the one that plays.
    slides.forEach((sl, i) => { const p = voicePack(i); prewarm(p, [revealText(p, sl)]); });
  };
  const onRevealSay = d => {
    if (!d?.slide || d.back || !settings.voiceOn || settings.sayReveal === false) return;
    if (!['show', 'intro', 'finale'].includes(d.what)) return;
    const p = voicePack(d.step ?? 0);
    const text = revealText(p, d.slide);
    if (!text) return;
    const key = `${d.step}|${d.slide.label}|${d.slide.title || ''}`;
    const said = spoken();
    if (d.initial && !d.preview && said[key] && Date.now() - said[key] < 6 * 3600 * 1000) return;
    if (!d.preview) {
      said[key] = Date.now();
      try { localStorage.setItem(SPOKEN_KEY, JSON.stringify(said)); } catch { /* ignore */ }
    }
    // After the sting has had its moment.
    const lead = d.what === 'intro' ? 1600 : d.what === 'finale' ? 2400 : String(d.slide.label).toUpperCase() === 'GRAND CHAMPION' ? 1800 : 1200;
    // The line is heard Audio-delay later than it's played: start it that much sooner (after the sting).
    director.speak({ pack: p, text }, { reveal: true, lead: Math.max(0, lead - leadMs()), tag: 'reveal' });
  };
  window.addEventListener('pw:revealLines', onRevealLines);
  offs.push(() => window.removeEventListener('pw:revealLines', onRevealLines));

  // ---------- the announce booth ----------
  // Every few minutes, when nothing else is being said or shown, DONNIE and DASH talk about the night
  // (lib/audio/booth.js decides when and what they're told; the `booth` edge function writes and voices it).
  const booth = new BoothRunner({
    settings: () => ({
      boothOn: settings.boothOn !== false && settings.voiceOn && !settings.muteAll, boothFreq: settings.boothFreq, boothRoast: settings.boothRoast,
      boothShort: !!settings.boothShort, boothExtras: settings.boothExtras !== false, duo: boothDuo(settings).join('+'),
    }),
    room: () => {
      const src = boothSource();
      // "Play a booth segment now" works in any phase but the reveal.
      const mode = src && !director.reveal ? boothMode(src.phase, { lastCall: src.lastCall }) || (booth.force ? 'freeplay' : null) : null;
      return {
        mode, sealed: !!src?.sealed, nearMark: nearMark(src?.party),
        quiet: !director.final && !src?.takeover && voiceQuietFor() > BOOTH.quietGap && Date.now() - lastMoment > BOOTH.quietGap,
        digest: () => buildDigest({ ...src, mode, sealed: !!src?.sealed }),
      };
    },
    fetchBit: async (digest, s, avoid, extras = {}) => {
      const a = await auth();
      if (!a) return null;
      return post({ ...a, digest, roast: s.boothRoast, short: s.boothShort, hosts: s.duo.split('+'), names: settings.sayNames || '', avoid, local: extras.local, lastUsedLocal: extras.lastUsedLocal, avoidPhrases: extras.avoidPhrases, repertoire: extras.repertoire }, 60000, BOOTH_URL);
    },
    // Tonight's used local-color items survive a TV reload (forgotten the next day).
    usedLocal: (() => { try { const v = JSON.parse(localStorage.getItem('pw.boothLocal') || 'null'); return new Set(v?.day === new Date().toDateString() ? v.ids : []); } catch { return new Set(); } })(),
    onUsedLocal: set => { try { localStorage.setItem('pw.boothLocal', JSON.stringify({ day: new Date().toDateString(), ids: [...set] })); } catch { /* ignore */ } },
    play: bit => { if (syncing) return false; const ok = director.speak({ url: bit.url, ms: bit.ms }, { tag: 'booth' }); if (ok) { boothPlaying = bit; setTimeout(() => { if (boothPlaying === bit) { boothPlaying = null; emitBooth(); } }, (bit.ms || 15000) + 1500); emitBooth(); } return ok; },
  });
  try { window.__pwBooth = booth; } catch { /* debugging from the console */ }
  const emitBooth = () => {
    state.booth = { on: settings.boothOn !== false, next: booth.nextAt, playing: !!boothPlaying, duo: boothDuo(settings), log: booth.log.map(l => ({ at: l.at, lines: l.lines })) };
    emit();
  };
  const boothIv = setInterval(() => { if (booth.tick() === 'played') emitBooth(); }, 5000);
  offs.push(() => clearInterval(boothIv));

  // ---------- one-liners: one host reacts as a score lands ----------
  // A personal best, a top-3 entry, a near miss, someone's first game, a spectacularly rough game. At most one per
  // 90 s, not in a rush of scores, only when nothing else is on; dropped if it isn't ready within 20 s.
  const quips = new QuipThrottle();
  const quipCounts = {};
  let seenScores = null, quipBusy = false;
  const quipTick = async () => {
    const src = boothSource();
    if (!src?.scores) return;
    const ids = new Set(src.scores.map(x => x.id));
    if (!seenScores) { seenScores = ids; return; } // what was already there when the TV loaded
    const fresh = src.scores.filter(x => !seenScores.has(x.id) && !x.voided);
    seenScores = ids;
    if (!fresh.length) return;
    quips.note(fresh.length);
    const mode = boothMode(src.phase, { lastCall: src.lastCall });
    if (!mode || !boothActive() || settings.muteAll || director.reveal || director.final || quipBusy) return;
    // Read the TV fresh each time (the line takes seconds to make: a takeover may be up by then, or results sealed).
    const room = () => { const s = boothSource(); return !!s && !s.takeover && !syncing && voiceQuietFor() > QUIP.quietFor && (booth.nextAt == null || booth.nextAt - Date.now() > 30000) && !director.final && !director.reveal && !nearMark(s.party); };
    // Chill booth (How often: Less): one-liners half as often too.
    if (!quips.allow({ quiet: room(), nearMark: nearMark(src.party), minGap: settings.boothFreq === 'less' ? QUIP.chillGap : QUIP.minGap })) return;
    const tourney = mode === 'tournament' || mode === 'lastcall';
    const pool = src.scores.filter(x => !tourney || !x.free_play);
    const s = [...fresh].reverse().find(x => !tourney || !x.free_play);
    const q = s && quipFor(s, { machines: src.machines, players: src.players, scores: pool, sealed: !!src.sealed });
    if (!q) return;
    const host = quipHost(boothDuo(settings), quipCounts);
    quipBusy = true;
    const t0 = Date.now();
    try {
      const a = await auth();
      if (!a) return;
      const avoid = booth.log.slice(-3).flatMap(l => l.lines.map(x => x.text));
      const r = await post({ ...a, kind: 'quip', host, moment: q.kind, facts: q.facts, sealed: !!src.sealed, names: settings.sayNames || '', avoid }, 15000, BOOTH_URL);
      const text = r?.lines?.[0]?.text;
      const sealedNow = !!src.sealed || !!boothSource()?.sealed;
      if (!r?.url || !safeQuip(text, { sealed: sealedNow }) || (sealedNow && !src.sealed && ['top3', 'close'].includes(q.kind)) || Date.now() - t0 > QUIP.stale || !boothActive() || !room()) { note('quip', { dropped: true, kind: q.kind }); return; }
      if (!director.speak({ url: r.url, ms: r.ms }, { tag: 'quip' })) return;
      quips.played();
      quipCounts[host] = (quipCounts[host] || 0) + 1;
      booth.log = [...booth.log, { at: Date.now(), lines: r.lines, quip: true }].slice(-6);
      emitBooth();
    } catch { /* skip this one */ } finally { quipBusy = false; }
  };
  const quipIv = setInterval(quipTick, 3000);
  offs.push(() => clearInterval(quipIv));

  // ---------- Spotify ----------
  async function startPlayer() {
    if (player || destroyed || !sp.hasLogin()) return;
    try {
      player = await sp.createPlayer({
        volume: Math.max(0, director.target()),
        on: {
          ready: ({ device_id }) => {
            deviceId = device_id;
            setSp({ ready: true, device: 'This TV (Woodside Pinball TV)', error: '' });
            refreshLists();
            if (state.unlocked && settings.autoplay && !settings.muteAll && !director.reveal && !deviceMode()) music.start();
          },
          not_ready: () => setSp({ ready: false }),
          player_state_changed: s => {
            sdkState = s;
            const t = s?.track_window?.current_track;
            if (!deviceMode()) setSp({ playing: !!s && !s.paused, track: t?.name || '', artist: (t?.artists || []).map(a => a.name).join(', '), context: s?.context?.uri || '' });
          },
          initialization_error: ({ message }) => setSp({ error: `Spotify player: ${message}` }),
          authentication_error: ({ message }) => setSp({ error: `Spotify login: ${message} (Connect again)` }),
          account_error: () => setSp({ error: 'Spotify Premium is needed to play in the browser' }),
          playback_error: ({ message }) => setSp({ error: `Spotify playback: ${message}` }),
          autoplay_failed: () => { autoplayBlocked = true; setSp({ error: 'Click the TV once to let the music play' }); },
        },
      });
    } catch (e) {
      player = null;
      setSp({ error: e.message });
    }
  }
  async function refreshLists() {
    if (!sp.hasLogin()) return;
    try {
      const [pl, dv] = await Promise.all([
        sp.api('GET', '/me/playlists?limit=50').catch(() => null),
        sp.api('GET', '/me/player/devices').catch(() => null),
      ]);
      publish('audio/lists', {
        at: Date.now(),
        playlists: (pl?.items || []).filter(Boolean).map(p => ({ uri: p.uri, name: p.name, n: p.items?.total ?? p.tracks?.total ?? null })),
        devices: (dv?.devices || []).filter(d => d.id !== deviceId).map(d => ({ id: d.id, name: d.name, type: d.type, active: d.is_active })),
        tvDevice: deviceId,
      }, { retain: true });
    } catch { /* host card just shows what it has */ }
  }
  let pollIv = null;
  function pollRemote() {
    if (pollIv) { clearInterval(pollIv); pollIv = null; }
    if (!deviceMode()) return;
    const go = () => sp.api('GET', '/me/player').then(p => {
      remote = p;
      const it = p?.item;
      setSp({ playing: !!p?.is_playing, track: it?.name || '', artist: (it?.artists || []).map(a => a.name).join(', '), context: p?.context?.uri || '', device: p?.device?.name || settings.outputName || '' });
    }).catch(() => {});
    go();
    pollIv = setInterval(go, 15000);
  }

  // ---------- audio delay (AirPlay) ----------
  // Time-critical sounds are played Audio-delay EARLIER than the screen: the final 10 s boops + the GAME OVER
  // beep (scheduled here from the end time), the reveal (Reveal.jsx shows each slide that much after its sounds),
  // the Sync test. The delay: a mic sync or the host's number, or what the Mac reports (see sync.js).
  const checkLatency = () => {
    const v = browserLatency(audioCtx());
    if (v !== browserLat) { browserLat = v; note('latency', { browser: v }); emit(); }
  };
  const latIv = setInterval(checkLatency, 30000);
  const onDevice = () => setTimeout(checkLatency, 1500);
  try { navigator.mediaDevices?.addEventListener?.('devicechange', onDevice); } catch { /* none */ }
  offs.push(() => { clearInterval(latIv); try { navigator.mediaDevices?.removeEventListener?.('devicechange', onDevice); } catch { /* none */ } });
  function leadMs() {
    if (audioCtx()?.state !== 'running' || settings.muteAll) return 0;
    return Math.round(delay().sec * 1000);
  }
  // The final 10 seconds: each boop n at (end − n s − delay), so it's heard as the TV shows n; the BEEEP follows
  // the "1" by a second (at the end − delay). A boop more than 0.3 s late (a reload mid-count) is skipped.
  const finalDone = new Set();
  const finalIv = setInterval(() => {
    const src = boothSource(), party = src?.party;
    const end = Date.parse(party?.tourney_ends_at || '');
    finalSched = !!(src?.phase && end && !party.reveal_active && !party.free_play && party.status !== 'closed');
    if (!finalSched) return;
    const now = serverNow(), lead = leadMs();
    for (let n = 10; n >= 1; n--) {
      const key = `${end}:${n}`, at = end - n * 1000 - lead;
      if (finalDone.has(key) || at - now > 350) continue;
      finalDone.add(key);
      if (now - at > 300) continue;
      setTimeout(() => { note('final', { n, lead }); director.tick(n); emit(); }, Math.max(0, at - now));
    }
  }, 100);
  offs.push(() => clearInterval(finalIv));

  // Sync test: three beeps, and the TV flashes white at the instant each should be heard. Tune the delay until
  // the beeps land on the flashes.
  function syncTest() {
    if (audioCtx()?.state !== 'running') { notice('Click the TV once first (sound is blocked)'); return; }
    const lead = leadMs();
    director.hold('sync', 0.2, lead + 4200);
    for (let i = 0; i < 3; i++) {
      const at = lead + 700 + i * 1100;
      setTimeout(() => { note('sfx', { name: 'syncBeep', n: i + 1 }); playSound('syncBeep'); }, at - lead);
      setTimeout(() => { note('flash', { n: i + 1, lead }); try { window.dispatchEvent(new CustomEvent('pw:syncflash', { detail: { n: i + 1 } })); } catch { /* ignore */ } }, at);
    }
    notice(`Sync test: beeps ${(lead / 1000).toFixed(1)} s ahead of the flashes`, 5000);
  }
  // Auto sync with the Mac's microphone: chirps out through the normal output (AirPlay), found in the mic.
  async function micSync() {
    if (syncing) return;
    syncing = true;
    state.sync = { running: true, at: Date.now(), done: 0, runs: 5 };
    stopVoice();
    director.hold('sync', 0, 40000);
    emit();
    try {
      const r = await measureWithMic(audioCtx(), { runs: 5, onProgress: (i, n) => { state.sync = { ...state.sync, done: i, runs: n }; emit(); } });
      state.sync = { ...r, running: false, at: Date.now() };
      note('micsync', r);
      if (r.ok) applySettings({ ...settings, audioDelay: Math.max(0, Math.min(3, Math.round(r.sec * 100) / 100)), delayMode: 'manual', delaySource: 'mic' });
    } catch (e) {
      state.sync = { ok: false, error: String(e?.message || e), running: false, at: Date.now() };
    } finally {
      syncing = false;
      director.unhold('sync');
      emit();
    }
  }

  // ---------- host commands ----------
  async function command(m) {
    if (!m || typeof m !== 'object' || Date.now() - (m.at || 0) > CMD_FRESH_MS) return;
    switch (m.cmd) {
      case 'connect': return sp.login(settings.clientId || sp.SPOTIFY_CLIENT_ID);
      case 'disconnect': sp.logout(); player?.disconnect(); player = null; deviceId = null; setSp({ ready: false, playing: false, track: '', artist: '' }); return;
      case 'play': return music.resume();
      case 'pause': return music.pause();
      case 'next': return music.next();
      case 'prev': return music.prev();
      case 'playlist': if (m.uri) { settings = { ...settings, playlist: m.uri, playlistName: m.name || '' }; saveSettings(settings); } return music.start({ restart: true });
      case 'refresh': refreshLists(); pollRemote(); return emit();
      case 'duck': return director.duckNow();
      case 'stopAll': director.stopAll(); wantPlaying = false; return emit();
      case 'announce': if (m.clip) director.announce(m.clip, { lead: TIMING.chimeLead, pre: 'chime' }); return;
      case 'preview': { const p = m.pack || settings.pack; if (!audioCtx()) return; say(p, clockText(p, m.clip || 'check'), { fallbackClip: m.clip || 'check' }); return; }
      case 'booth': booth.playNow(); booth.tick(); return emitBooth();
      case 'boothSkip': stopVoice(); boothPlaying = null; return emitBooth();
      case 'synctest': return syncTest();
      case 'micsync': return micSync();
      case 'say': {
        // The host's "Say something": through the director (music dips), or straight out if it's quiet time.
        const text = String(m.text || '').slice(0, 300).trim();
        if (!text || settings.muteAll) return;
        const p = voicePack();
        if (!director.speak({ pack: p, text }, { tag: 'say' })) say(p, text, { tag: 'say' });
        return;
      }
      case 'test': return test(m.cue);
      default:
    }
  }
  function test(cue) {
    const d = director;
    if (cue === 'small') return d.small();
    if (cue === 'big') { d.lastBig = -Infinity; return d.bigMoment(); }
    if (cue === 'mark') return d.clock({ what: 'mark', side: 'start', minutes: 5 });
    if (cue === 'endmark') return d.clock({ what: 'mark', side: 'end', minutes: 15 });
    if (cue === 'start') return d.clock({ what: 'start', side: 'start', minutes: 0 });
    if (cue === 'final') {
      for (let n = 10; n >= 1; n--) setTimeout(() => d.tick(n), (10 - n) * 1000);
      setTimeout(() => d.clock({ what: 'end', side: 'end', minutes: 0 }), 10600);
      return;
    }
    if (cue === 'reveal') {
      d.revealStart();
      setTimeout(() => d.revealSlide({ events: [0, 1000, 2000].map(at => ({ at, s: 'tick' })), show: 3000 }), 3000);
      setTimeout(() => d.revealSlide({ events: [...Array(6)].map((_, k) => ({ at: 300 + k * 450, s: 'step' })).concat([{ at: 3000, s: 'land' }]), show: 4200 }), 8000);
      setTimeout(() => d.revealSlide({ grand: true, events: [], show: 0 }), 14000);
      setTimeout(() => { d.revealEnd(); emit(); }, 20000);
      return emit();
    }
    if (cue === 'sting') return playSound('sting');
    if (cue === 'grand') return playSound('grandSting');
    if (cue === 'spin') {
      const ev = []; for (let i = 0; i < 24; i++) ev.push({ at: 2600 * (1 - Math.pow(1 - (i + 1) / 24, 0.25)), s: 'roll' });
      for (let i = 0; i < 20; i++) ev.push({ at: 2600 + 6200 * (1 - Math.pow(1 - (i + 0.5) / 20, 0.25)), s: 'clack' });
      ev.push({ at: 8800, s: 'stop' });
      d.revealSlide({ events: ev, show: 10100 });
      setTimeout(() => { d.revealEnd(); emit(); }, 13000);
      return;
    }
  }

  offs.push(subscribe('audio/cmd', m => { command(m); }));
  offs.push(subscribe('audio/settings', m => { if (m && typeof m === 'object' && !Array.isArray(m)) applySettings(m, { fromHost: true }); }));

  // ---------- go ----------
  loadManifest().then(() => voicePacks().forEach(preloadPack)); // the countdown lines, ready ahead of time
  (async () => {
    const cb = await sp.handleCallback();
    if (cb?.ok) notice('Spotify connected ✔');
    else if (cb?.error) { setSp({ error: cb.error }); notice(cb.error); }
    if (sp.hasLogin()) { startPlayer(); pollRemote(); }
    emit();
  })();
  const beat = setInterval(emit, 20000);
  const bye = () => publish('audio/state', { at: Date.now(), off: true, page: 'tv' }, { retain: true });
  window.addEventListener('pagehide', bye);
  offs.push(() => window.removeEventListener('pagehide', bye));

  return {
    state,
    unlock,
    connect: () => sp.login(settings.clientId || sp.SPOTIFY_CLIENT_ID),
    director,
    command,
    applySettings: s => applySettings({ ...settings, ...s }, { fromHost: true }), // as if from the host card
    voiceBusy,
    leadMs: () => leadMs(),
    // The TV shows / leaves the reveal (TvAudio's `reveal` prop), and on-screen reveal sounds.
    setReveal(on) { if (on) director.revealStart(); else director.revealEnd(); emit(); },
    revealCue(name, opts) { if (director.reveal) director.revealCue(name, opts); },
    destroy() {
      destroyed = true;
      clearInterval(beat);
      setVoiceListener(null);
      if (pollIv) clearInterval(pollIv);
      if (ramp) clearInterval(ramp);
      for (const f of offs) { try { f(); } catch { /* ignore */ } }
      setGate(null);
      director.destroy();
      try { player?.disconnect(); } catch { /* ignore */ }
      bye();
    },
  };
}
