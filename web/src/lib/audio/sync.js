// Audio delay: how much later the garage hears the TV's sounds than the screen shows them (AirPlay to the
// WiiM buffers ~2 s). The TV plays its time-critical sounds (final-10 s boops, the GAME OVER beep, the reveal's
// 3-2-1 / stings / Match spin) that much EARLIER than the picture.
//
// Three ways to know it, best first:
//   1. "Auto sync with mic": the TV plays a few short chirps and listens with the Mac's microphone; the
//      round trip (minus the mic's own input latency) is the delay (`measureWithMic`).
//   2. Auto from the browser: AudioContext.outputLatency (+ baseLatency), which macOS can report for
//      AirPlay outputs; used when it looks plausible (0.3 – 4 s) (`browserLatency`).
//   3. The host's number (default 2.0 s: AirPlay 2's usual buffered latency from a Mac).
// Pure helpers (makeChirp, fft, correlate, findLag, summarize) are tested in sync.test.js with a simulated
// delayed loopback.

export const DEFAULT_DELAY = 2.0; // seconds: AirPlay / AirPlay 2 buffered audio from a Mac is ~2 s
export const MAX_DELAY = 3;
export const PLAUSIBLE = [0.3, 4]; // browser-reported latency we trust (s)

// The delay in use: { sec, source: 'auto' | 'manual' | 'mic' | 'default', browser }.
export function effectiveDelay(settings = {}, browser = null) {
  const clamp = v => Math.max(0, Math.min(MAX_DELAY, Math.round(Number(v) * 100) / 100));
  const manual = Number.isFinite(Number(settings.audioDelay)) ? clamp(settings.audioDelay) : DEFAULT_DELAY;
  if (settings.delayMode === 'manual') return { sec: manual, source: settings.delaySource === 'mic' ? 'mic' : 'manual', browser };
  if (browser != null && browser >= PLAUSIBLE[0] && browser <= PLAUSIBLE[1]) return { sec: clamp(browser), source: 'auto', browser };
  return { sec: manual, source: 'default', browser };
}
export function delayText(d) {
  if (!d) return '';
  const s = `${d.sec.toFixed(1)} s`;
  if (d.source === 'auto') return `Auto (${s} from the Mac)`;
  if (d.source === 'mic') return `Mic sync ${s}`;
  if (d.source === 'manual') return `Manual ${s}`;
  return `Auto unavailable → using ${s}`;
}

// What the browser says the output adds (s), or null.
export function browserLatency(ctx) {
  if (!ctx) return null;
  const o = Number(ctx.outputLatency), b = Number(ctx.baseLatency);
  if (!Number.isFinite(o) || o <= 0) return null;
  return o + (Number.isFinite(b) && b > 0 ? b : 0);
}

// ---------- signal ----------
// A linear chirp (f0 → f1 Hz) with a Hann window: sharp, unmistakable correlation peak.
export function makeChirp(sr, { dur = 0.12, f0 = 900, f1 = 6000, amp = 0.6 } = {}) {
  const n = Math.round(sr * dur), out = new Float32Array(n);
  const k = (f1 - f0) / dur;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    out[i] = amp * w * Math.sin(2 * Math.PI * (f0 * t + 0.5 * k * t * t));
  }
  return out;
}

// In-place iterative radix-2 FFT (re, im: Float64Array of a power-of-two length).
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// Cross-correlation of `rec` with `ref` for lags 0 … rec.length - 1 (FFT).
export function correlate(rec, ref) {
  let n = 1;
  while (n < rec.length + ref.length) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(rec); br.set(ref);
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) { // A · conj(B)
    const r = ar[i] * br[i] + ai[i] * bi[i], im = ai[i] * br[i] - ar[i] * bi[i];
    ar[i] = r; ai[i] = im;
  }
  fft(ar, ai, true);
  return ar.subarray(0, rec.length);
}

// Where `ref` sits in `rec`: { lag (samples), peak, ratio } — ratio = the peak over the next-best peak at
// least 20 ms away (a clean echo of the chirp gives 3+; noise gives ~1).
export function findLag(rec, ref, sr) {
  const c = correlate(rec, ref);
  let best = 0, bi = -1;
  for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > best) { best = v; bi = i; } }
  const guard = Math.round(sr * 0.02);
  let second = 0;
  for (let i = 0; i < c.length; i++) if (Math.abs(i - bi) > guard) second = Math.max(second, Math.abs(c[i]));
  return { lag: bi, peak: best, ratio: second ? best / second : Infinity };
}

// Several runs → the result. A run counts when its peak stands out (ratio ≥ 2.5); the delay is the median.
export function summarize(runs, { minRatio = 2.5 } = {}) {
  const ok = runs.filter(r => r && Number.isFinite(r.sec) && r.ratio >= minRatio).map(r => r.sec).sort((a, b) => a - b);
  if (ok.length < 2) return { ok: false, error: runs.length ? 'The microphone couldn’t hear the test chirps clearly. Turn the WiiM up a little (or move the Mac closer to a speaker) and try again.' : 'No measurements.', runs: runs.length, good: ok.length };
  const mid = ok.length >> 1;
  const sec = ok.length % 2 ? ok[mid] : (ok[mid - 1] + ok[mid]) / 2;
  const spread = ok[ok.length - 1] - ok[0];
  const confidence = ok.length >= 3 && spread <= 0.03 ? 'high' : spread <= 0.08 ? 'medium' : 'low';
  return { ok: true, sec: Math.round(sec * 1000) / 1000, spread: Math.round(spread * 1000) / 1000, good: ok.length, runs: runs.length, confidence };
}

// ---------- the measurement (browser) ----------
const WORKLET = `class PwRec extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage({ t: currentTime, d: ch.slice(0) }); return true; }
}
registerProcessor('pw-rec', PwRec);`;

// Plays `runs` chirps through `ctx.destination` (the normal output, out to AirPlay) and finds each one in the
// microphone. Resolves { ok, sec, confidence, spread, good, runs, inputLatency } or { ok: false, error }.
export async function measureWithMic(ctx, { runs = 5, gap = 4.2, onProgress } = {}) {
  if (!ctx || ctx.state !== 'running') return { ok: false, error: 'The TV needs its one click for sound first.' };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, error: 'This browser can’t use the microphone.' };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    return { ok: false, error: e?.name === 'NotAllowedError' ? 'Microphone not allowed. On the TV Mac, click Allow when Chrome asks (or the camera icon in the address bar → Allow), then try again.' : `No microphone (${e?.name || e?.message || 'error'}).` };
  }
  const track = stream.getAudioTracks()[0];
  const inLat = Number(track?.getSettings?.().latency);
  const inputLatency = Number.isFinite(inLat) && inLat > 0 && inLat < 0.5 ? inLat : 0.01; // built-in mic ≈ 10 ms
  const sr = ctx.sampleRate;
  const blocks = [];
  let node = null, src = null, sink = null;
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    src = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'pw-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    node.port.onmessage = e => blocks.push(e.data);
    sink = ctx.createGain(); sink.gain.value = 0; // keeps the recorder running without sending the mic out
    src.connect(node); node.connect(sink); sink.connect(ctx.destination);
    const chirp = makeChirp(sr);
    const buf = ctx.createBuffer(1, chirp.length, sr);
    buf.copyToChannel(chirp, 0);
    const out = [];
    for (let i = 0; i < runs; i++) {
      const at = ctx.currentTime + 0.25;
      const s = ctx.createBufferSource(), g = ctx.createGain();
      g.gain.value = 0.9; s.buffer = buf; s.connect(g); g.connect(ctx.destination); s.start(at);
      await new Promise(r => setTimeout(r, Math.max(gap, at - ctx.currentTime + MAX_DELAY + 1.1) * 1000));
      // The recording from the chirp's start to MAX_DELAY + 1 s after it.
      const from = at - 0.05, to = at + MAX_DELAY + 1;
      const parts = blocks.filter(b => b.t + b.d.length / sr > from && b.t < to);
      if (!parts.length) { out.push(null); continue; }
      const t0 = parts[0].t;
      const rec = new Float32Array(parts.reduce((n, b) => n + b.d.length, 0));
      let k = 0; for (const b of parts) { rec.set(b.d, k); k += b.d.length; }
      const f = findLag(rec, chirp, sr);
      const sec = t0 + f.lag / sr - at - inputLatency;
      out.push({ sec, ratio: f.ratio });
      onProgress?.(i + 1, runs, sec, f.ratio);
      blocks.splice(0, blocks.length);
    }
    return { ...summarize(out), inputLatency };
  } catch (e) {
    return { ok: false, error: `Mic sync failed: ${e?.message || e}` };
  } finally {
    try { src?.disconnect(); node?.disconnect(); sink?.disconnect(); } catch { /* ignore */ }
    for (const t of stream.getTracks()) t.stop();
  }
}
