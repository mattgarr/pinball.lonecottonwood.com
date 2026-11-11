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
import { AudioDirector, DEFAULT_SETTINGS, TIMING, revealEventCue } from './policy.js';
import { playSound, stopSounds } from './synth.js';
import { BOOTH_URL, DEFAULT_PACK, auth, loadManifest, post, preloadPack, prewarm, say, sayClip, setSayNames, setVoiceVolume, stopVoice, voiceQuietFor } from './voice.js';
import { BOOTH, BoothRunner, boothMode, boothSource, buildDigest, momentFact, nearMark } from './booth.js';
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
  boothOn: true, boothFreq: 'normal', boothRoast: 'gentle',
};

const readSettings = () => { try { return { ...AUDIO_DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || {}) }; } catch { return { ...AUDIO_DEFAULTS }; } };
const saveSettings = s => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private window */ } };

let rt = null;      // the running host
let refs = 0;
let stopTimer = null;
const listeners = new Set();

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
      music: (v, ms) => { music.setLevel(v, ms); emit(); },
      pauseMusic: () => { if (music.isPlaying()) { const was = wantPlaying; music.pause(); wantPlaying = was; } },
      resumeMusic: () => { if (wantPlaying || settings.autoplay) music.resume(); },
      isPlaying: () => music.isPlaying() || wantPlaying,
      sound: (name, opts) => playSound(name, opts),
      voice: clip => (settings.voiceOn && settings.sayClock !== false ? sayClip(settings.pack || DEFAULT_PACK, clip) : 0),
      // A booth bit ({ url }) plays with the neutral voice chain; text lines in the chosen announcer's voice.
      say: text => (settings.voiceOn ? say(typeof text === 'object' ? 'booth' : settings.pack || DEFAULT_PACK, text) : 0),
      stopSounds: () => { stopSounds(); stopVoice(); },
      levels: ({ fx, voice }) => {
        const c = audioCtx(), b = fxBus();
        if (c && b) b.gain.setTargetAtTime(fx, c.currentTime, 0.05);
        setVoiceVolume(voice);
      },
    },
  });
  const origSetSettings = director.setSettings.bind(director);
  setGate(name => director.gate(name));

  function applySettings(next, { fromHost = false } = {}) {
    const prev = settings;
    settings = { ...AUDIO_DEFAULTS, ...next };
    saveSettings(settings);
    setSayNames(settings.sayNames);
    origSetSettings({ musicVol: settings.musicVol, fxVol: settings.fxVol, voiceVol: settings.voiceVol, voiceOn: settings.voiceOn, muteAll: settings.muteAll, pack: settings.pack,
      sayClock: settings.sayClock, sayRecords: settings.sayRecords, sayJoins: settings.sayJoins, sayReveal: settings.sayReveal });
    if (settings.pack !== prev.pack && state.unlocked) preloadPack(settings.pack);
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
    preloadPack(settings.pack || DEFAULT_PACK);
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
  const onSound = e => { if (e.detail?.on) { applySettings(settings); preloadPack(settings.pack); } emit(); };
  window.addEventListener('pw:sound', onSound);
  offs.push(() => window.removeEventListener('pw:sound', onSound));
  const onVis = () => { if (document.visibilityState === 'visible') setTimeout(emit, 500); };
  document.addEventListener('visibilitychange', onVis);
  offs.push(() => document.removeEventListener('visibilitychange', onVis));

  // ---------- the TV's moments ----------
  const onClock = e => { director.clock(e.detail); emit(); };
  let lastRevealStep = null;
  const onReveal = e => {
    const cue = revealEventCue(e.detail);
    if (cue) director.revealCue(cue); else director.revealStart();
    // A new prize on screen: whatever the announcer was still saying about the last one stops.
    if (e.detail?.step != null && e.detail.step !== lastRevealStep) { if (lastRevealStep != null) stopVoice(); lastRevealStep = e.detail.step; }
    onRevealSay(e.detail);
    emit();
  };
  window.addEventListener('pw:clock', onClock);
  window.addEventListener('pw:reveal', onReveal);
  offs.push(() => { window.removeEventListener('pw:clock', onClock); window.removeEventListener('pw:reveal', onReveal); });

  // ---------- the announcer's live lines ----------
  const pack = () => settings.pack || DEFAULT_PACK;
  // A takeover or toast on the TV (TV.jsx `pw:moment`): records, a new #1, someone ranked, a games
  // milestone, people joining. While results are sealed (last 15 min until the reveal) nothing about
  // the standings is said.
  let joins = [], joinTimer = null, lastWelcome = 0, lastMoment = 0;
  const WELCOME_GAP = 20000, JOIN_GATHER = 3000;
  const flushJoins = () => {
    joinTimer = null;
    const ps = joins; joins = [];
    if (!ps.length || settings.sayJoins === false) return;
    lastWelcome = Date.now();
    director.speak(momentText(pack(), { kind: 'join', players: ps }), { lead: 600 });
  };
  const onMoment = e => {
    const m = e.detail;
    lastMoment = Date.now();
    if (m?.kind) booth.event({ kind: m.kind, text: m.sealed && ['leader', 'ranked', 'climb', 'shame'].includes(m.kind) ? null : momentFact(m) });
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
    director.speak(momentText(pack(), m), { lead: 1500 });
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
    prewarm(pack(), slides.map(sl => revealText(pack(), sl)));
  };
  const onRevealSay = d => {
    if (!d?.slide || d.back || !settings.voiceOn || settings.sayReveal === false) return;
    if (!['show', 'intro', 'finale'].includes(d.what)) return;
    const text = revealText(pack(), d.slide);
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
    director.speak(text, { reveal: true, lead });
  };
  window.addEventListener('pw:revealLines', onRevealLines);
  offs.push(() => window.removeEventListener('pw:revealLines', onRevealLines));

  // ---------- the announce booth ----------
  // Every few minutes, when nothing else is being said or shown, DONNIE and DASH talk about the night
  // (lib/audio/booth.js decides when and what they're told; the `booth` edge function writes and voices it).
  const booth = new BoothRunner({
    settings: () => ({ boothOn: settings.boothOn !== false && settings.voiceOn && !settings.muteAll, boothFreq: settings.boothFreq, boothRoast: settings.boothRoast }),
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
    fetchBit: async (digest, s, avoid) => {
      const a = await auth();
      if (!a) return null;
      return post({ ...a, digest, roast: s.boothRoast, names: settings.sayNames || '', avoid }, 60000, BOOTH_URL);
    },
    play: bit => { const ok = director.speak({ url: bit.url, ms: bit.ms }); if (ok) { boothPlaying = bit; setTimeout(() => { if (boothPlaying === bit) { boothPlaying = null; emitBooth(); } }, (bit.ms || 15000) + 1500); emitBooth(); } return ok; },
  });
  let boothPlaying = null;
  try { window.__pwBooth = booth; } catch { /* debugging from the console */ }
  const emitBooth = () => {
    state.booth = { on: settings.boothOn !== false, next: booth.nextAt, playing: !!boothPlaying, log: booth.log.map(l => ({ at: l.at, lines: l.lines })) };
    emit();
  };
  const boothIv = setInterval(() => { if (booth.tick() === 'played') emitBooth(); }, 5000);
  offs.push(() => clearInterval(boothIv));

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
      case 'say': {
        // The host's "Say something": through the director (music dips), or straight out if it's quiet time.
        const text = String(m.text || '').slice(0, 300).trim();
        if (!text || settings.muteAll) return;
        if (!director.speak(text)) say(pack(), text);
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
  loadManifest().then(() => preloadPack(settings.pack || DEFAULT_PACK)); // the countdown lines, ready ahead of time
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
    // The TV shows / leaves the reveal (TvAudio's `reveal` prop), and on-screen reveal sounds.
    setReveal(on) { if (on) director.revealStart(); else director.revealEnd(); emit(); },
    revealCue(name, opts) { if (director.reveal) director.revealCue(name, opts); },
    destroy() {
      destroyed = true;
      clearInterval(beat);
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
