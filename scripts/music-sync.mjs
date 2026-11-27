// Music → garage lights, from the music this laptop is playing (no microphone).
//   node scripts/music-sync.mjs                 (runs until stopped; leave it going all night)
//   node scripts/music-sync.mjs --debug         (prints levels and beats)
//
// Setup (once): the laptop's sound output is a Multi-Output Device = the speakers + "BlackHole 2ch",
// so BlackHole hears exactly what plays. This script records BlackHole with sox (brew install sox), and:
//   1. Sends WLED "Audio Sync" packets (v2, UDP multicast 239.0.0.1:11988, ~45/s) so every sound-reactive
//      effect (Music mode) follows the song instead of the controller's mic. The controller's
//      AudioReactive sync mode is set to Receive.
//   2. Beat pulse (when switched on from the host lights card): on each kick drum the room's ambient
//      layers jump to full brightness and ease back. Only on the attract looks: house lights, the
//      reveal, flashes and the sound-reactive looks are left alone.
// The speakers are AirPlay, which plays ~2 s behind; `lag` (ms, set on the host lights card) delays
// everything to match what you hear.
//
// Settings come from the retained MQTT message <channel>/beat: { on, lag }. This script reports on
// <channel>/beat/status (retained): { running, at, level, beats }.
import { readFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import mqtt from '../web/node_modules/mqtt/build/index.js';

const DEBUG = process.argv.includes('--debug');
const SUPA = 'https://llmggdjxiffkwnjuogxf.supabase.co';
const KEY = 'sb_publishable_7oGSOVFpRFVnJ5SeRcjYsQ_a6EQyojv';
// Node can't always resolve .local names itself; ask macOS (falls back to the last known address).
const wledIp = () => { try { return /ip_address: (\S+)/.exec(execFileSync('dscacheutil', ['-q', 'host', '-a', 'name', 'wled-garage.local'], { timeout: 4000 }).toString())?.[1]; } catch { return null; } };
const WLED = process.env.WLED || `http://${wledIp() || '192.168.1.106'}`;
const DEVICE = process.env.AUDIO_DEVICE || 'BlackHole 2ch';
const RATE = 22050, FRAME = 512; // ~23 ms per analysis frame (43/s)
const BASE_SEGS = [0, 1, 8]; // the ambient layers (walls + beam, beam band, curb)
const REST_BRI = 150, KICK_BRI = 255; // beat pulse: resting level and the kick
// Ambient looks the pulse may touch (WLED effect ids): Colorwaves, Plasma, Aurora, Flow, Twinklefox.
const PULSE_FX = new Set([67, 97, 38, 110, 80]);

const pass = readFileSync(new URL('../HOST_PASSCODE.txt', import.meta.url), 'utf8').split('\n')[2].trim();
const rpc = async (fn, body) => {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${fn}: ${r.status}`);
  return r.json();
};
const topic = await rpc('host_lights_topic', { p_pass: pass });
if (!topic) throw new Error('No lights channel (wrong host passcode?)');

let settings = { on: false, lag: 2000 };
let beats = 0, level = 0;
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// --- controller ----------------------------------------------------------------------------------
const post = body => fetch(`${WLED}/json/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(1500) }).catch(() => null);
let wled = null; // last polled state
async function poll() {
  try { wled = await (await fetch(`${WLED}/json/state`, { signal: AbortSignal.timeout(1500) })).json(); } catch { wled = null; }
}
setInterval(poll, 1500); await poll();
try { // receive the audio feed instead of the mic (harmless to repeat)
  await fetch(`${WLED}/json/cfg`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ um: { AudioReactive: { sync: { port: 11988, mode: 2 } } } }), signal: AbortSignal.timeout(3000) });
  log('controller audio sync: receive');
} catch { log('controller not reachable yet; will keep trying to pulse'); }

const pulseOk = () => wled?.on && BASE_SEGS.every(id => { const s = wled.seg?.find(x => x.id === id); return s && s.on && PULSE_FX.has(s.fx); });
let resting = false;
function kick() {
  if (!settings.on || !pulseOk()) return;
  post({ tt: 0, seg: BASE_SEGS.map(id => ({ id, bri: KICK_BRI })) });
  setTimeout(() => post({ tt: 4, seg: BASE_SEGS.map(id => ({ id, bri: REST_BRI })) }), 70); // eases back over 400 ms
  resting = true;
}
// Switched off: put the full level back.
function unrest() { if (resting && pulseOk()) post({ seg: BASE_SEGS.map(id => ({ id, bri: 255 })) }); resting = false; }

// --- MQTT: settings + status ---------------------------------------------------------------------
const mq = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', { clientId: `beat-${Math.random().toString(16).slice(2, 8)}`, reconnectPeriod: 4000 });
mq.on('connect', () => { mq.subscribe(`${topic}/beat`); log('connected to the lights channel'); });
mq.on('message', (t, m) => {
  try {
    const s = JSON.parse(m.toString());
    const was = settings.on;
    settings = { on: !!s.on, lag: Math.max(0, Math.min(5000, Number(s.lag) || 0)) };
    log(`beat pulse ${settings.on ? 'ON' : 'off'}, lag ${settings.lag} ms`);
    if (was && !settings.on) unrest();
  } catch { /* ignore */ }
});
const status = () => mq.connected && mq.publish(`${topic}/beat/status`, JSON.stringify({ running: true, at: Date.now(), level: Math.round(level), beats, on: settings.on, lag: settings.lag }), { retain: true });
setInterval(status, 5000);

// --- audio analysis ------------------------------------------------------------------------------
// Radix-2 FFT on FRAME samples (Hann window).
const N = FRAME, re = new Float64Array(N), im = new Float64Array(N);
const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
const rev = Uint32Array.from({ length: N }, (_, i) => { let r = 0; for (let b = 1, x = i; b < N; b <<= 1, x >>= 1) r = (r << 1) | (x & 1); return r; });
function fft() {
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let size = 2; size <= N; size <<= 1) {
    const h = size >> 1, step = (-2 * Math.PI) / size;
    for (let s = 0; s < N; s += size) for (let k = 0; k < h; k++) {
      const c = Math.cos(step * k), d = Math.sin(step * k), a = s + k, b = a + h;
      const tr = re[b] * c - im[b] * d, ti = re[b] * d + im[b] * c;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}
// 16 bands, log-spaced 43 Hz – 9 kHz like WLED's GEQ (bin = 43 Hz at 22050/512).
const HZ = RATE / N;
const edges = Array.from({ length: 17 }, (_, i) => Math.max(1, Math.round((43 * Math.pow(9000 / 43, i / 16)) / HZ)));
let agc = 1e-3, rmsAgc = 1e-4, bassAvg = 0, lastBeat = 0, frameCounter = 0, smooth = 0;

const sock = dgram.createSocket('udp4');
sock.bind(() => { try { sock.setMulticastTTL(2); } catch { /* ignore */ } });
function sendSync(raw, smth, peak, bands, mag, peakHz) {
  const b = Buffer.alloc(44);
  b.write('00002', 0, 'ascii'); // header[6] (NUL-terminated)
  b.writeFloatLE(raw, 8); b.writeFloatLE(smth, 12);
  b.writeUInt8(peak ? 1 : 0, 16); b.writeUInt8(frameCounter++ & 255, 17);
  bands.forEach((v, i) => b.writeUInt8(v, 18 + i));
  b.writeUInt16LE(0, 34); b.writeFloatLE(mag, 36); b.writeFloatLE(peakHz, 40);
  sock.send(b, 11988, '239.0.0.1');
}

function analyze(samples) {
  let rms = 0;
  for (let i = 0; i < N; i++) { const v = samples[i] / 32768; rms += v * v; re[i] = v * hann[i]; im[i] = 0; }
  rms = Math.sqrt(rms / N);
  fft();
  const mags = new Float64Array(N / 2);
  let peakBin = 1, peakMag = 0;
  for (let i = 1; i < N / 2; i++) { mags[i] = Math.hypot(re[i], im[i]); if (mags[i] > peakMag) { peakMag = mags[i]; peakBin = i; } }
  const raw = [];
  for (let k = 0; k < 16; k++) { let m = 0; const a = edges[k], z = Math.max(edges[k + 1], a + 1); for (let i = a; i < z; i++) m = Math.max(m, mags[i]); raw.push(m); }
  // Automatic gain: the loudest band recently maps to ~255 (slow decay so quiet songs still move).
  agc = Math.max(Math.max(...raw), agc * 0.9985, 1e-3);
  const bands = raw.map(m => Math.min(255, Math.round((255 * m) / agc)));
  // Volume: the loudest moment recently maps to ~255 (same slow-decay gain as the bands).
  rmsAgc = Math.max(rms, rmsAgc * 0.9985, 1e-4);
  const vol = Math.min(255, (255 * rms) / rmsAgc);
  smooth = smooth * 0.8 + vol * 0.2; level = smooth;
  // Kick: bass (≈43–170 Hz) jumps well above its recent average, at most ~4 per second.
  const bass = mags.slice(1, 5).reduce((s, v) => s + v, 0);
  const now = Date.now();
  const beat = bass > bassAvg * 1.5 && bass > agc * 0.6 && now - lastBeat > 250;
  bassAvg = bassAvg * 0.95 + bass * 0.05;
  if (beat) { lastBeat = now; beats++; }
  const out = () => { sendSync(vol, smooth, beat, bands, peakMag, peakBin * HZ); if (beat) kick(); };
  if (settings.lag > 0) setTimeout(out, settings.lag); else out();
  if (DEBUG && frameCounter % 20 === 0) log(`vol ${vol.toFixed(0).padStart(3)} bands ${bands.map(v => String(v).padStart(3)).join('')}${beat ? '  BEAT' : ''}`);
}

function startCapture() {
  const sox = spawn('sox', ['-q', '-t', 'coreaudio', DEVICE, '-t', 'raw', '-r', String(RATE), '-e', 'signed', '-b', '16', '-c', '1', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = Buffer.alloc(0);
  sox.stdout.on('data', d => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= N * 2) {
      const frame = new Int16Array(N);
      for (let i = 0; i < N; i++) frame[i] = buf.readInt16LE(i * 2);
      buf = buf.subarray(N * 2);
      analyze(frame);
    }
  });
  sox.stderr.on('data', d => DEBUG && process.stderr.write(d));
  sox.on('exit', code => { log(`audio capture stopped (${code}); restarting in 3 s`); setTimeout(startCapture, 3000); });
  log(`listening to "${DEVICE}"`);
}
startCapture();
const bye = () => { unrest(); mq.publish(`${topic}/beat/status`, JSON.stringify({ running: false, at: Date.now() }), { retain: true }, () => process.exit(0)); setTimeout(() => process.exit(0), 1500); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
