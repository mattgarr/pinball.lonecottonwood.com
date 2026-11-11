// The announcer's voice. Every line is spoken by Gemini text-to-speech (edge function `tts`, one of six
// designed voices), saved once in storage and decoded into the shared AudioContext, then played through
// a light per-pack effect chain (presence, a touch of reverb for the ship, a bit-crush for the 8-bit
// computer, an old-radio band for the newsreel). Lines play one at a time, never on top of each other.
//
// Offline safety: the countdown / phase lines also exist as pre-rendered clips in
// /audio/voices/<pack>/<clip>.m4a (scripts/make-voices.py --engine gemini, the same voices). A countdown
// line that isn't ready within 4 s plays that clip instead; a live line (a record, a welcome) that isn't
// ready in time is skipped. Last resort for a countdown line: the browser's own speech voice.
//
// The TV authenticates with the host passcode once, then keeps a 7-day announcer token, so the voice
// keeps working after the host unlock (2 days) runs out. Lines it has heard before play straight from
// storage (their addresses are remembered in this browser), with no call at all.
import { audioCtx } from '../chiptune.js';
import { SUPABASE_KEY, SUPABASE_URL, getHostPass } from '../store.js';
import { clockText, clockVariants, plainText } from './lines.js';

export const VOICE_BASE = '/audio/voices';
export const PACK_IDS = ['british', 'hype', 'ship', '8bit', 'newsreel', 'dj'];
export const PACK_NAMES = { british: 'British agent', hype: 'Arcade hype', ship: 'Ship computer', '8bit': '8-bit computer', newsreel: 'Retro newsreel', dj: 'Fun-center DJ' };
export const DEFAULT_PACK = 'british';
export const clipUrl = (pack, clip) => `${VOICE_BASE}/${pack}/${clip}.m4a`;
const TTS_URL = `${SUPABASE_URL}/functions/v1/tts`;
const CACHE_KEY = 'pw.ttsCache';
const TOKEN_KEY = 'pw.ttsToken';
const CACHE_MAX = 800;

let manifest = null;
let manifestP = null;
const buffers = new Map(); // url -> AudioBuffer
const loading = new Map(); // url -> Promise<AudioBuffer|null>
const lines = new Map();   // `${pack}|${text}` -> Promise<{ url, ms }|null> (in flight)
let gain = null;
let vol = 1;
const chains = new Map();  // pack -> input node
let playing = new Set();

// ---------- storage of what we've heard ----------
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full / private */ } },
};
let known = null; // { key: [url, ms, at] }
function knownLines() { if (!known) known = ls.get(CACHE_KEY) || {}; return known; }
function remember(key, url, ms) {
  const k = knownLines();
  k[key] = [url, ms || 0, Date.now()];
  const keys = Object.keys(k);
  if (keys.length > CACHE_MAX) keys.sort((a, b) => k[a][2] - k[b][2]).slice(0, keys.length - CACHE_MAX).forEach(x => delete k[x]);
  ls.set(CACHE_KEY, k);
}

// ---------- the voice service ----------
let tokenP = null;
async function auth() {
  const pass = getHostPass();
  const t = ls.get(TOKEN_KEY);
  if (t?.token && t.exp - Date.now() > 24 * 3600 * 1000) return { token: t.token };
  if (pass) {
    // Swap the passcode for a 7-day token in the background (the passcode works meanwhile).
    tokenP ||= post({ pass, action: 'token' }, 8000).then(r => { if (r?.token) ls.set(TOKEN_KEY, { token: r.token, exp: r.exp }); }).catch(() => {}).finally(() => { setTimeout(() => { tokenP = null; }, 60000); });
    return { pass };
  }
  return t?.token && t.exp > Date.now() ? { token: t.token } : null;
}
async function post(body, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(TTS_URL, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify(body) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(out.error || `tts ${r.status}`), { status: r.status });
    return out;
  } finally { clearTimeout(timer); }
}
export const canSpeak = () => !!(getHostPass() || (ls.get(TOKEN_KEY)?.exp > Date.now()));

// The address of a spoken line (generated on first use). Resolves null if it can't be had.
export function lineUrl(pack, text, { style } = {}) {
  const key = `${pack}|${style || ''}|${text}`;
  const k = knownLines()[key];
  if (k) return Promise.resolve({ url: k[0], ms: k[1] });
  if (lines.has(key)) return lines.get(key);
  const p = (async () => {
    const a = await auth();
    if (!a) return null;
    const r = await post({ ...a, text, pack, style }, 30000);
    if (!r?.url) return null;
    remember(key, r.url, r.ms);
    return { url: r.url, ms: r.ms };
  })().catch(() => null).finally(() => lines.delete(key));
  lines.set(key, p);
  return p;
}

// ---------- audio ----------
function out() {
  const ctx = audioCtx();
  if (!ctx) return null;
  if (!gain) { gain = ctx.createGain(); gain.gain.value = vol; gain.connect(ctx.destination); }
  return gain;
}
export function setVoiceVolume(v) {
  vol = Math.max(0, Math.min(1.5, Number(v) || 0));
  const ctx = audioCtx();
  if (gain && ctx) gain.gain.setTargetAtTime(vol, ctx.currentTime, 0.05);
}
function decode(url) {
  if (buffers.has(url)) return Promise.resolve(buffers.get(url));
  if (loading.has(url)) return loading.get(url);
  const ctx = audioCtx();
  if (!ctx) return Promise.resolve(null);
  const p = fetch(url)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(b => ctx.decodeAudioData(b))
    .then(buf => { buffers.set(url, buf); if (buffers.size > 300) buffers.delete(buffers.keys().next().value); return buf; })
    .catch(() => null)
    .finally(() => loading.delete(url));
  loading.set(url, p);
  return p;
}

// Each pack's character, kept light: intelligibility in a noisy garage comes first.
function impulse(ctx, seconds, decay) {
  const n = Math.round(ctx.sampleRate * seconds), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
  return b;
}
function chain(pack) {
  const ctx = audioCtx(), o = out();
  if (!ctx || !o) return null;
  if (chains.has(pack)) return chains.get(pack);
  const f = (type, freq, q = 0.7, g = 0) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = freq; n.Q.value = q; n.gain.value = g; return n; };
  const comp = (th = -20, ratio = 3) => { const c = ctx.createDynamicsCompressor(); c.threshold.value = th; c.ratio.value = ratio; c.attack.value = 0.004; c.release.value = 0.12; c.knee.value = 6; return c; };
  const series = (...ns) => { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns; };
  const input = ctx.createGain();
  const make = gainOut => { const g = ctx.createGain(); g.gain.value = gainOut; g.connect(o); return g; };
  if (pack === 'ship') {
    const [hp, , c] = series(f('highpass', 70), f('lowshelf', 180, 0.7, 2), comp(-22, 3), make(1));
    input.connect(hp);
    const rev = ctx.createConvolver(); rev.buffer = impulse(ctx, 2.2, 3);
    const wet = make(0.22); c.connect(rev); rev.connect(wet);
  } else if (pack === '8bit') {
    const crush = ctx.createWaveShaper();
    const steps = 24, curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.round(x * steps) / steps; }
    crush.curve = curve;
    // Half crushed, half clean, so the words stay clear.
    const hp = f('highpass', 150), wet = ctx.createGain(), dry = ctx.createGain(), sum = ctx.createGain();
    wet.gain.value = 0.55; dry.gain.value = 0.45;
    input.connect(hp); hp.connect(crush); crush.connect(wet); hp.connect(dry); wet.connect(sum); dry.connect(sum);
    series(sum, f('lowpass', 5500), comp(-22, 4), make(1));
  } else if (pack === 'newsreel') {
    const sat = ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(1.8 * x) / Math.tanh(1.8); }
    sat.curve = curve;
    const [hp] = series(f('highpass', 320), f('lowpass', 3600), f('peaking', 1200, 1.2, 3), sat, comp(-22, 4), make(0.9));
    input.connect(hp);
  } else {
    // british, hype, dj: presence for a noisy room, gentle compression.
    const lo = pack === 'hype' ? 110 : 90;
    const [hp] = series(f('highpass', lo), f('peaking', pack === 'hype' ? 2600 : 3000, 0.9, pack === 'hype' ? 4 : 3), comp(pack === 'british' ? -22 : -26, pack === 'british' ? 3 : 5), make(1));
    input.connect(hp);
  }
  chains.set(pack, input);
  return input;
}
function playBuffer(pack, buf) {
  const ctx = audioCtx(), into = chain(pack);
  if (!ctx || !into || !buf || ctx.state !== 'running') return 0;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(into);
  playing.add(src);
  const done = new Promise(res => { src.onended = () => { playing.delete(src); res(); }; });
  src.start();
  return { ms: Math.round(buf.duration * 1000), done };
}

// ---------- the queue: one line at a time ----------
const queue = [];
let busy = false;
let stopGen = 0;
async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const item = queue.shift();
      const gen = stopGen;
      if (Date.now() - item.at > item.maxWait) { item.resolve(0); continue; }
      const buf = await item.ready;
      if (gen !== stopGen) { item.resolve(0); continue; }
      const p = buf ? playBuffer(item.pack, buf) : 0;
      if (!p) {
        if (item.speech) speech(item.pack, item.speech);
        item.resolve(item.speech ? 2500 : 0);
        continue;
      }
      item.resolve(p.ms);
      await p.done;
      await new Promise(r => setTimeout(r, 250)); // a breath between lines
    }
  } finally { busy = false; }
}
const timeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

// Speak `text` (queued behind anything playing). Resolves when it starts, with its length in ms
// (0: skipped). fallbackClip: a pre-rendered clip to use if the line isn't ready within `wait` ms.
export function say(pack, text, { fallbackClip = null, wait = 9000, maxWait = 25000, style } = {}) {
  if (!text) return Promise.resolve(0);
  return new Promise(resolve => {
    const ready = (async () => {
      const line = await timeout(lineUrl(pack, text, { style }), wait);
      const buf = line ? await timeout(decode(line.url), 4000) : null;
      if (buf) return buf;
      if (fallbackClip) return timeout(decode(clipUrl(pack, fallbackClip)), 3000);
      return null;
    })();
    queue.push({ pack, text, ready, resolve, at: Date.now(), maxWait, speech: fallbackClip ? text : null });
    pump();
  });
}

// A countdown / phase line: one of its variants, or the pre-rendered clip if the voice is slow.
export function sayClip(pack, clip) {
  return say(pack, clockText(pack, clip), { fallbackClip: clip, wait: 4000, maxWait: 15000 });
}

// Get lines ready before they're needed (a few at a time).
export async function prewarm(pack, texts, { decodeToo = true } = {}) {
  const list = [...new Set(texts.filter(Boolean))];
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const t = list[i++];
      const line = await lineUrl(pack, t);
      if (line && decodeToo && audioCtx()) await decode(line.url);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
// Every countdown line of a pack (all variants), plus the offline clips.
export function preloadPack(pack) {
  loadManifest();
  const clips = Object.keys(manifest?.packs?.[pack]?.ms || {});
  for (const c of clips) decode(clipUrl(pack, c));
  if (!canSpeak()) return Promise.resolve();
  const texts = [];
  for (const c of ['start5', 'start4', 'start3', 'start2', 'start1', 'on', 'end15', 'end10', 'end5', 'end4', 'end3', 'end2', 'end1', 'timesup', 'awards', 'freeplay', 'check']) texts.push(...clockVariants(pack, c));
  return prewarm(pack, texts);
}
export function loadManifest() {
  manifestP ||= fetch(`${VOICE_BASE}/manifest.json`).then(r => r.json()).then(m => { manifest = m; return m; }).catch(() => null);
  return manifestP;
}

// Play a pre-rendered clip now (host preview, offline). Returns its length in ms.
export function playClip(pack, clip) {
  const url = clipUrl(pack, clip);
  const buf = buffers.get(url);
  const p = buf && playBuffer(pack, buf);
  if (p) return p.ms;
  decode(url).then(b => { if (b) playBuffer(pack, b); else speech(pack, clockText(pack, clip)); });
  return manifest?.packs?.[pack]?.ms?.[clip] || 2500;
}

function speech(pack, text) {
  try {
    if (!text || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(plainText(text));
    u.volume = Math.min(1, vol);
    u.lang = pack === 'british' ? 'en-GB' : 'en-US';
    window.speechSynthesis.speak(u);
  } catch { /* no speech */ }
}

export function stopVoice() {
  stopGen++;
  for (const q of queue.splice(0)) q.resolve(0);
  for (const s of playing) { try { s.stop(); } catch { /* ended */ } }
  playing = new Set();
  try { window.speechSynthesis?.cancel(); } catch { /* none */ }
}
