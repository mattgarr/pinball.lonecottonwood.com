// Announcer voice packs: pre-rendered clips in /audio/voices/<pack>/<clip>.m4a (scripts/make-voices.py).
// Clips are fetched and decoded into the shared AudioContext when a pack is chosen, so playback is
// instant and offline-safe. Last resort (a clip that failed to load): the browser's own speech voice.
import { audioCtx } from '../chiptune.js';

export const VOICE_BASE = '/audio/voices';
export const PACK_IDS = ['british', 'hype', 'ship', '8bit', 'newsreel'];
export const PACK_NAMES = { british: 'British agent', hype: 'Arcade hype', ship: 'Ship computer', '8bit': '8-bit computer', newsreel: 'Retro newsreel' };
export const DEFAULT_PACK = 'british';
export const clipUrl = (pack, clip) => `${VOICE_BASE}/${pack}/${clip}.m4a`;

let manifest = null;
let manifestP = null;
const buffers = new Map(); // `${pack}/${clip}` -> AudioBuffer
const loading = new Map();
let gain = null;
let playing = new Set();
let vol = 1;

export function loadManifest() {
  manifestP ||= fetch(`${VOICE_BASE}/manifest.json`).then(r => r.json()).then(m => { manifest = m; return m; }).catch(() => null);
  return manifestP;
}

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

async function load(pack, clip) {
  const k = `${pack}/${clip}`;
  if (buffers.has(k)) return buffers.get(k);
  if (loading.has(k)) return loading.get(k);
  const ctx = audioCtx();
  if (!ctx) return null;
  const p = fetch(clipUrl(pack, clip))
    .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(b => ctx.decodeAudioData(b))
    .then(buf => { buffers.set(k, buf); loading.delete(k); return buf; })
    .catch(() => { loading.delete(k); return null; });
  loading.set(k, p);
  return p;
}

// Decode a whole pack (call once the AudioContext exists, e.g. after the click that unlocks sound).
export async function preloadPack(pack) {
  const m = await loadManifest();
  const clips = m?.clips || [];
  await Promise.all(clips.map(c => load(pack, c)));
}

// Play a clip now. Returns its length in ms (what the director holds the music duck for).
export function playClip(pack, clip) {
  const ctx = audioCtx(), o = out();
  const k = `${pack}/${clip}`;
  const buf = buffers.get(k);
  const ms = manifest?.packs?.[pack]?.ms?.[clip] || 2500;
  if (ctx && o && buf && ctx.state === 'running') {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(o);
    src.onended = () => playing.delete(src);
    playing.add(src);
    src.start();
    return Math.round(buf.duration * 1000);
  }
  // Not decoded yet: decode and play it as soon as it's ready (a second's delay at most).
  if (ctx && o) {
    load(pack, clip).then(b => { if (b) playClip(pack, clip); else speak(pack, clip); });
    return ms + 600;
  }
  speak(pack, clip);
  return ms;
}

function speak(pack, clip) {
  try {
    const text = manifest?.packs?.[pack]?.lines?.[clip];
    if (!text || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.volume = Math.min(1, vol);
    u.lang = pack === 'british' ? 'en-GB' : 'en-US';
    window.speechSynthesis.speak(u);
  } catch { /* no speech */ }
}

export function stopVoice() {
  for (const s of playing) { try { s.stop(); } catch { /* ended */ } }
  playing = new Set();
  try { window.speechSynthesis?.cancel(); } catch { /* none */ }
}
