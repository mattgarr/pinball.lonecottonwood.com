import { useEffect, useRef, useState } from 'react';
import { readCache, readScoreFromPhoto, scanFrames } from '../lib/photo.js';
import { useParty } from '../lib/store.js';
import { captureTips } from '../lib/captureTips.js';

// Scan mode override for experiments: ?scan=video | video8 | video15 | frames (sticky), ?scan=auto clears it.
// Otherwise each machine's calibrated setting (machines.scan_mode / scan_fps) is used.
function flagMode() {
  try {
    const q = new URLSearchParams(location.search).get('scan');
    if (q === 'auto') localStorage.removeItem('pw.scan');
    else if (q) localStorage.setItem('pw.scan', q);
    return localStorage.getItem('pw.scan');
  } catch { return null; }
}
const FLAG = flagMode();



// Point-and-wait score scanner. Opens the live camera and starts scanning by itself:
// grabs frames for ~4 s (cropped to the on-screen box), keeps the sharpest from each moment, asks the AI to combine them. If the display
// is showing a logo / high-score table instead of player scores, it keeps watching and retries
// (up to ROUNDS times). Dot-matrix screens cycle and flicker, which is why one photo isn't enough.
//
// onDone(frame) — best frame (data URL); its AI result is cached in photo.js so the caller's
//                 normal read returns instantly. Called with the read result even if empty.
// onFallback(fromTap) — use the phone's regular camera instead.
const SCAN_MS = 3500;   // long enough to catch displays that alternate (scores <-> high score)
const EVERY_MS = 250;
const KEEP = 4;         // frames sent per round, spread evenly over the scan
const ROUNDS = 3;
const MAX_SIDE = 1024;  // cropped frame size sent to the AI
const CLIP_SIDE = 960;  // video clip size
const CLIP_BPS = 1_500_000; // video bitrate: small uploads matter more than pixels
// Fast path: two stills from different moments of the burst are read in parallel while it records.
// Both must be confident AND agree exactly (rolling-shutter / multiplex glitches differ frame to frame).
const EARLY_AT = [600, 1300];

// A read we can trust without waiting for the video: player scores shown, confident, not the high-score
// screen, and not the same number on every display (Centaur shows its high score on all four).
function sameScores(a, b) {
  const k = r => (r?.scores || []).filter(s => s.value > 0).map(s => `${s.slot}:${s.value}`).sort().join('|');
  return k(a) !== '' && k(a) === k(b);
}
function confidentRead(r) {
  const vals = (r?.scores || []).filter(s => s.value > 0).map(s => s.value);
  if (!r || r.error || r.confidence !== 'high' || !vals.length) return false;
  if (vals.length >= 2 && vals.every(v => v === vals[0])) return false;
  return true;
}

function sharpness(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  let sum = 0, n = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = (y * w + x) * 4;
      const g = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      const gx = data[i + 4] * 0.3 + data[i + 5] * 0.59 + data[i + 6] * 0.11;
      const gy = data[i + w * 4] * 0.3 + data[i + w * 4 + 1] * 0.59 + data[i + w * 4 + 2] * 0.11;
      sum += Math.abs(g - gx) + Math.abs(g - gy); n++;
    }
  }
  return n ? sum / n : 0;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const machineIdFromUrl = () => Number((location.pathname.match(/\/machine\/(\d+)/) || [])[1]) || null;

// testMode = { mode: 'frames'|'video', fps, machineId } for host calibration; then onResult gets the raw read.
export default function Scanner({ onDone, onFallback, onCancel, onType, testMode, onResult }) {
  const { machines } = useParty();
  const machineId = testMode?.machineId ?? machineIdFromUrl();
  const machine = machines.find(m => m.id === machineId);
  // Method: 'burst' (2.5 s clip), 'video' (5 s clip) or 'frames' (still frames, voted).
  const mode = testMode ? testMode.mode
    : FLAG ? (FLAG === 'burst' ? 'burst' : FLAG.startsWith('video') ? 'video' : 'frames')
    : (machine?.scan_mode || 'frames');
  const isVideo = mode === 'video' || mode === 'burst';
  const clipMs = mode === 'burst' ? 2500 : 5000;
  const vfps = testMode?.fps || (FLAG?.startsWith('video') && Number(FLAG.replace('video', ''))) || machine?.scan_fps || (mode === 'burst' ? 10 : 8);
  const guide = captureTips(machine);
  const label0 = mode === 'burst' ? 'Burst' : mode === 'video' ? 'Video' : 'Frames';
  const video = useRef(null);
  const box = useRef(null);
  const stream = useRef(null);
  const alive = useRef(true);
  const [phase, setPhase] = useState('starting'); // starting | scanning | reading | waiting | gaveup
  const [progress, setProgress] = useState(0);
  const [round, setRound] = useState(0);
  const [msg, setMsg] = useState('');
  const [upload, setUpload] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [job, setJob] = useState(null); // calibration: which method is being sent
  useEffect(() => {
    if (phase !== 'reading') return;
    const t0 = Date.now(); setElapsed(0);
    const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        if (!alive.current) { s.getTracks().forEach(t => t.stop()); return; }
        stream.current = s;
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
        setPhase('aiming'); // wait for the player to line it up and tap READY
      } catch {
        if (alive.current) onFallback(false);
      }
    })();
    return () => { alive.current = false; stream.current?.getTracks().forEach(t => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The part of the camera image that sits under the on-screen box (plus a margin), in video pixels.
  function cropRect() {
    const v = video.current, b = box.current;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!b) return { x: 0, y: 0, w: vw, h: vh };
    const er = v.getBoundingClientRect(), br = b.getBoundingClientRect();
    const scale = Math.max(er.width / vw, er.height / vh); // object-fit: cover
    const offX = (er.width - vw * scale) / 2, offY = (er.height - vh * scale) / 2;
    const mx = br.width * 0.08, my = br.height * 0.12;
    let x = (br.left - mx - er.left - offX) / scale, y = (br.top - my - er.top - offY) / scale;
    let w = (br.width + 2 * mx) / scale, h = (br.height + 2 * my) / scale;
    x = Math.max(0, x); y = Math.max(0, y); w = Math.min(vw - x, w); h = Math.min(vh - y, h);
    return { x, y, w, h };
  }

  async function grab() {
    const v = video.current;
    const c = cropRect();
    const k = Math.min(1, MAX_SIDE / Math.max(c.w, c.h));
    const W = Math.round(c.w * k), H = Math.round(c.h * k);
    const big = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const small = Object.assign(document.createElement('canvas'), { width: 200, height: Math.max(1, Math.round(200 * H / W)) });
    const bctx = big.getContext('2d'), sctx = small.getContext('2d', { willReadFrequently: true });
    const frames = [];
    const t0 = performance.now();
    while (alive.current && performance.now() - t0 < SCAN_MS) {
      bctx.drawImage(v, c.x, c.y, c.w, c.h, 0, 0, W, H);
      sctx.drawImage(big, 0, 0, small.width, small.height);
      frames.push({ score: sharpness(sctx, small.width, small.height), url: big.toDataURL('image/jpeg', 0.8) });
      setProgress(Math.min(1, (performance.now() - t0) / SCAN_MS));
      await sleep(EVERY_MS);
    }
    // One sharp frame from each slice of time, so alternating screens are all represented.
    const per = Math.ceil(frames.length / KEEP);
    const picked = [];
    for (let i = 0; i < frames.length; i += per) {
      const best = frames.slice(i, i + per).sort((a, b) => b.score - a.score)[0];
      if (best) picked.push(best);
    }
    return picked.sort((a, b) => b.score - a.score).map(f => f.url);
  }

  // Record a short clip of the boxed area (cropped via a canvas stream when the browser allows it),
  // plus the sharpest still as proof. Returns { still, clip } (clip may be null).
  // onEarly(still): called once ~0.6 s in with the sharpest still so far, so it can be read while we
  // keep recording. Returning true from shouldStop() ends the recording early.
  async function recordClip(onEarly, shouldStop) {
    let nextEarly = 0, windowBest = { score: -1, url: null };
    const v = video.current;
    const c = cropRect();
    const k = Math.min(1, CLIP_SIDE / Math.max(c.w, c.h));
    const W = Math.round(c.w * k / 2) * 2, H = Math.round(c.h * k / 2) * 2;
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = canvas.getContext('2d');
    const small = Object.assign(document.createElement('canvas'), { width: 200, height: Math.max(1, Math.round(200 * H / W)) });
    const sctx = small.getContext('2d', { willReadFrequently: true });
    const src = canvas.captureStream ? canvas.captureStream(30) : stream.current;
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const type = types.find(t => window.MediaRecorder?.isTypeSupported?.(t));
    let rec = null; const chunks = [];
    try {
      rec = new MediaRecorder(src, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: CLIP_BPS });
      rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      rec.start(250);
    } catch { rec = null; }
    let best = { score: -1, url: null };
    const t0 = performance.now(); let n = 0;
    while (alive.current && performance.now() - t0 < clipMs && !shouldStop?.()) {
      ctx.drawImage(v, c.x, c.y, c.w, c.h, 0, 0, W, H);
      if (n++ % 6 === 0) {
        sctx.drawImage(canvas, 0, 0, small.width, small.height);
        const sc = sharpness(sctx, small.width, small.height);
        const url = (sc > best.score || sc > windowBest.score) ? canvas.toDataURL('image/jpeg', 0.75) : null;
        if (sc > best.score) best = { score: sc, url };
        if (sc > windowBest.score) windowBest = { score: sc, url };
      }
      // sharpest still of each time window goes out for an early read
      if (onEarly && nextEarly < EARLY_AT.length && windowBest.url && performance.now() - t0 >= EARLY_AT[nextEarly]) {
        onEarly(windowBest.url, nextEarly); nextEarly++; windowBest = { score: -1, url: null };
      }
      setProgress(Math.min(1, (performance.now() - t0) / clipMs));
      await sleep(33); // ~30 fps into the recording, so high Gemini sampling rates see distinct frames
    }
    let clip = null;
    if (rec) {
      await new Promise(r => { rec.onstop = r; rec.stop(); });
      const blob = new Blob(chunks, { type: (rec.mimeType || type || 'video/mp4').split(';')[0] });
      if (blob.size) clip = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    }
    return { still: best.url, clip };
  }

  // Calibration: ONE 5-second capture feeds every method (same moment, same glare), then each method
  // is sent and timed on its own. Returns [{ method, fps, frame, result, captureMs, uploadMs, sendMs, uploadKB, clipSent }].
  async function captureAll() {
    const v = video.current;
    const c = cropRect();
    const kc = Math.min(1, CLIP_SIDE / Math.max(c.w, c.h));
    const W = Math.round(c.w * kc / 2) * 2, H = Math.round(c.h * kc / 2) * 2;
    const clipCanvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const cctx = clipCanvas.getContext('2d');
    const kf = Math.min(1, MAX_SIDE / Math.max(c.w, c.h));
    const FW = Math.round(c.w * kf), FH = Math.round(c.h * kf);
    const frameCanvas = Object.assign(document.createElement('canvas'), { width: FW, height: FH });
    const fctx = frameCanvas.getContext('2d');
    const small = Object.assign(document.createElement('canvas'), { width: 200, height: Math.max(1, Math.round(200 * H / W)) });
    const sctx = small.getContext('2d', { willReadFrequently: true });
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const type = types.find(t => window.MediaRecorder?.isTypeSupported?.(t));
    const src = clipCanvas.captureStream ? clipCanvas.captureStream(30) : stream.current;
    const mkRec = () => {
      try {
        const chunks = [];
        const rec = new MediaRecorder(src, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: CLIP_BPS });
        rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
        rec.start(250);
        return { rec, chunks };
      } catch { return null; }
    };
    const toUrl = r => new Promise(res => {
      if (!r) return res(null);
      r.rec.onstop = () => {
        const blob = new Blob(r.chunks, { type: (r.rec.mimeType || type || 'video/mp4').split(';')[0] });
        if (!blob.size) return res(null);
        const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob);
      };
      r.rec.stop();
    });
    const burstRec = mkRec(), videoRec = mkRec();
    let burstClipP = null;
    const stills = []; let bestBurst = { score: -1 }, bestVideo = { score: -1 };
    const t0 = performance.now(); let n = 0, lastStill = -1e9;
    while (alive.current && performance.now() - t0 < 5000) {
      const t = performance.now() - t0;
      cctx.drawImage(v, c.x, c.y, c.w, c.h, 0, 0, W, H);
      if (n++ % 6 === 0) {
        sctx.drawImage(clipCanvas, 0, 0, small.width, small.height);
        const sc = sharpness(sctx, small.width, small.height);
        if (t < 2500 && sc > bestBurst.score) bestBurst = { score: sc, url: clipCanvas.toDataURL('image/jpeg', 0.75) };
        if (sc > bestVideo.score) bestVideo = { score: sc, url: clipCanvas.toDataURL('image/jpeg', 0.75) };
        if (t < SCAN_MS && t - lastStill >= EVERY_MS) {
          fctx.drawImage(v, c.x, c.y, c.w, c.h, 0, 0, FW, FH);
          stills.push({ score: sc, t, url: frameCanvas.toDataURL('image/jpeg', 0.8) });
          lastStill = t;
        }
      }
      if (t >= 2500 && !burstClipP) burstClipP = toUrl(burstRec);
      setProgress(Math.min(1, t / 5000));
      await sleep(33);
    }
    const burstClip = await (burstClipP || toUrl(burstRec));
    const videoClip = await toUrl(videoRec);
    // frames: one sharp still from each slice of time
    const per = Math.ceil(stills.length / KEEP); const picked = [];
    for (let i = 0; i < stills.length; i += per) { const b = stills.slice(i, i + per).sort((a, b2) => b2.score - a.score)[0]; if (b) picked.push(b); }
    const frameUrls = picked.sort((a, b) => b.score - a.score).map(f => f.url);
    stream.current?.getTracks().forEach(t => t.stop());

    const jobs = [
      { method: 'burst', fps: 10, frame: bestBurst.url, opts: burstClip ? { video: burstClip, fps: 10 } : {}, captureMs: 2500, kb: (bestBurst.url?.length || 0) + (burstClip?.length || 0) },
      { method: 'video', fps: 8, frame: bestVideo.url, opts: videoClip ? { video: videoClip, fps: 8 } : {}, captureMs: 5000, kb: (bestVideo.url?.length || 0) + (videoClip?.length || 0) },
      { method: 'frames', fps: null, frame: frameUrls[0], extra: frameUrls.slice(1), opts: {}, captureMs: SCAN_MS, kb: frameUrls.reduce((t, f) => t + f.length, 0) },
    ];
    const out = [];
    for (let i = 0; i < jobs.length && alive.current; i++) {
      const j = jobs[i];
      setJob({ i, n: jobs.length, label: j.method });
      if (!j.frame) { out.push({ ...j, result: null, uploadMs: null, sendMs: null, uploadKB: 0, clipSent: false }); continue; }
      if (j.extra) scanFrames.set(j.frame, j.extra);
      setPhase('sending'); setUpload(0);
      const ts = performance.now();
      const result = await readScoreFromPhoto(j.frame, { id: machineId }, {
        ...j.opts,
        onProgress: p => { if (p.phase === 'upload') setUpload(p.frac); else setPhase('reading'); },
      });
      out.push({ method: j.method, fps: j.fps, frame: j.frame, result, captureMs: j.captureMs, uploadMs: result?.uploadMs ?? null,
        sendMs: Math.round(performance.now() - ts), uploadKB: Math.round(j.kb * 0.75 / 1024), clipSent: !!j.opts.video });
    }
    return out;
  }

  async function run() {
    if (testMode?.all) {
      setPhase('scanning');
      const all = await captureAll();
      if (!alive.current) return;
      alive.current = false;
      onResult?.({ all, frame: all.find(a => a.frame)?.frame });
      return;
    }
    const rounds = testMode ? 1 : ROUNDS;
    for (let r = 1; r <= rounds && alive.current; r++) {
      const tStart = performance.now();
      setRound(r);
      setPhase('scanning');
      let frames, opts = {};
      let early = null; // { still, result } once two early stills agree
      let earlyP = null;
      const earlyReads = [];
      if (isVideo) {
        // Fast path: read one sharp still while the burst keeps recording. A confident player-scores
        // read wins; otherwise the burst clip decides exactly as before.
        const useEarly = !testMode && !!machineId;
        const { still, clip } = await recordClip(
          useEarly ? (s, i) => {
            const p = readScoreFromPhoto(s, { id: machineId }, {})
              .then(res => {
                earlyReads[i] = confidentRead(res) ? { still: s, result: res } : false;
                const [a, b] = earlyReads;
                if (a && b && sameScores(a.result, b.result)) early = a;
                return res;
              })
              .catch(() => { earlyReads[i] = false; return null; });
            earlyP = earlyP ? Promise.all([earlyP, p]) : p;
          } : null,
          () => !!early,
        );
        if (!alive.current) return;
        if (early) { readCache.set(early.still, early.result); finish(early.still); return; }
        frames = still ? [still] : [];
        if (clip) opts = { video: clip, fps: vfps };
      } else {
        frames = await grab();
      }
      if (!alive.current || !frames.length) return;
      const captureMs = Math.round(performance.now() - tStart);
      scanFrames.set(frames[0], frames.slice(1));
      if (!machineId) { finish(frames[0]); return; } // not on a machine page: let the caller read it
      setPhase('sending'); setUpload(0);
      const clipP = readScoreFromPhoto(frames[0], { id: machineId }, {
        ...opts,
        onProgress: p => { if (p.phase === 'upload') setUpload(p.frac); else setPhase('reading'); },
      });
      // Whichever confident read lands first: the early still (if still pending) or the clip.
      if (earlyP && !early) {
        const first = await Promise.race([clipP.then(r => ({ src: 'clip', r })), earlyP.then(() => (early ? { src: 'early' } : clipP.then(r => ({ src: 'clip', r }))))]);
        if (!alive.current) return;
        if (first.src === 'early' && early) { readCache.set(early.still, early.result); finish(early.still); return; }
      }
      if (!alive.current) return;
      const result = await clipP;
      if (!alive.current) return;
      if (!confidentRead(result) && earlyP) {
        await earlyP; // the early still may still land a confident read
        if (!alive.current) return;
        if (early) { readCache.set(early.still, early.result); finish(early.still); return; }
      }
      if (testMode) {
        alive.current = false;
        stream.current?.getTracks().forEach(t => t.stop());
        onResult?.({ frame: frames[0], result, ms: Math.round(performance.now() - tStart), captureMs, uploadMs: result?.uploadMs ?? null, method: mode, uploadKB: Math.round(frames.reduce((t, f) => t + f.length, 0) * 0.75 / 1024) + (opts.video ? Math.round(opts.video.length * 0.75 / 1024) : 0), mode, fps: isVideo ? vfps : null, clipSent: !!opts.video });
        return;
      }
      if (result?.scores?.some(s => s.value > 0)) { readCache.set(frames[0], result); finish(frames[0]); return; }
      if (!result || result.error) { finish(frames[0]); return; } // service trouble: fall through to keypad
      setMsg(result.note || '');
      setPhase('waiting');
      await sleep(900);
    }
    if (alive.current) setPhase('gaveup');
  }

  function finish(frame) {
    alive.current = false;
    stream.current?.getTracks().forEach(t => t.stop());
    onDone(frame);
  }

  function retry() {
    alive.current = true;
    if (!stream.current?.active) { onFallback(false); return; }
    run();
  }

  function ready() {
    if (phase !== 'aiming') return;
    run();
  }

  const label =
    phase === 'starting' ? 'Starting camera…'
    : phase === 'aiming' ? 'Line it up'
    : phase === 'scanning' ? (testMode?.all ? 'Recording 5s · hold still' : round > 1 ? 'Watching…' : 'Hold steady…')
    : phase === 'sending' ? (job ? `Test ${job.i + 1}/${job.n} ${job.label}: sending` : 'Sending…')
    : phase === 'reading' ? (job ? `Test ${job.i + 1}/${job.n} ${job.label}: ${elapsed}s` : `Reading… ${elapsed}s`)
    : phase === 'waiting' ? 'Waiting for scores…'
    : 'No scores found';

  return (
    <div className="scanner" role="dialog" aria-label="Scan the score display">
      <video ref={video} className="scanner-video" playsInline muted />
      <div ref={box} className={`scanner-frame ${guide.shape}${phase === 'reading' || phase === 'sending' ? ' reading' : ''}`} />
      <div className="scanner-top">
        <span className="scanner-pill">{machine?.name}{testMode?.all ? ' · calibration' : (testMode || FLAG) ? ` · ${label0}${isVideo ? ` ${vfps}fps` : ''}${testMode ? ' · test' : ''}` : ''}</span>
        <button type="button" className="scanner-x" onClick={() => { alive.current = false; onCancel(); }} aria-label="Cancel">✕</button>
      </div>
      <div className="scanner-bottom">
        <div className="scanner-tip">{label}</div>
        {(phase === 'starting' || phase === 'aiming') && <div className="scanner-sub">{guide.aim}</div>}
        {phase === 'scanning' && <div className="scanner-bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
        {phase === 'sending' && <div className="scanner-bar send"><span style={{ width: `${Math.round(upload * 100)}%` }} /></div>}
        {phase === 'reading' && <div className="scanner-spinner" aria-hidden="true" />}
        {phase === 'waiting' && (
          <div className="scanner-sub">
            {msg && /high|attract|not visible|champion/i.test(msg) ? 'Showing something else. ' : ''}
            Keep aiming. It cycles back.
          </div>
        )}
        {phase === 'aiming' && <button type="button" className="scanner-go" onClick={ready}>Ready</button>}
        {phase === 'gaveup' ? (
          <>
            <div className="scanner-sub">Scan right after the game, while scores show.</div>
            <button type="button" className="scanner-go" onClick={retry}>↻ Scan again</button>
            <button type="button" className="linkbtn small scanner-alt" onClick={() => { alive.current = false; (onType || onCancel)(); }}>Type it instead</button>
          </>
        ) : (
          <button type="button" className="linkbtn small scanner-alt" onClick={() => { alive.current = false; onFallback(true); }}>Trouble? Take a normal photo instead</button>
        )}
      </div>
    </div>
  );
}
