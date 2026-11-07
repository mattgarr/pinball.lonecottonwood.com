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
const VIDEO_MS = 5000;


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
const KEEP = 6;         // frames sent per round, spread evenly over the scan
const ROUNDS = 3;
const AIM_MS = 1800; // countdown before the first capture, so people can aim
const MAX_SIDE = 1280;  // cropped frame size sent to the AI

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
export default function Scanner({ onDone, onFallback, onCancel, testMode, onResult }) {
  const { machines } = useParty();
  const machineId = testMode?.machineId ?? machineIdFromUrl();
  const machine = machines.find(m => m.id === machineId);
  const isVideo = testMode ? testMode.mode === 'video'
    : FLAG ? FLAG.startsWith('video') : machine?.scan_mode === 'video';
  const vfps = testMode ? (testMode.fps || 4)
    : FLAG?.startsWith('video') ? (Number(FLAG.replace('video', '')) || 4) : (machine?.scan_fps || 4);
  const guide = captureTips(machine);
  const video = useRef(null);
  const box = useRef(null);
  const stream = useRef(null);
  const alive = useRef(true);
  const [phase, setPhase] = useState('starting'); // starting | scanning | reading | waiting | gaveup
  const [progress, setProgress] = useState(0);
  const [round, setRound] = useState(0);
  const [msg, setMsg] = useState('');
  const [count, setCount] = useState(3);

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
        setPhase('aiming');
        for (let n = Math.ceil(AIM_MS / 600); n > 0 && alive.current; n--) { setCount(n); await sleep(600); }
        if (alive.current) run();
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

  // Experimental: record a short clip of the boxed area (cropped via a canvas stream when the browser
  // allows it), plus the sharpest still as proof. Returns { still, clip } (clip may be null).
  async function recordClip() {
    const v = video.current;
    const c = cropRect();
    const k = Math.min(1, 1280 / Math.max(c.w, c.h));
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
      rec = new MediaRecorder(src, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 5_000_000 });
      rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      rec.start(250);
    } catch { rec = null; }
    let best = { score: -1, url: null };
    const t0 = performance.now(); let n = 0;
    while (alive.current && performance.now() - t0 < VIDEO_MS) {
      ctx.drawImage(v, c.x, c.y, c.w, c.h, 0, 0, W, H);
      if (n++ % 6 === 0) {
        sctx.drawImage(canvas, 0, 0, small.width, small.height);
        const sc = sharpness(sctx, small.width, small.height);
        if (sc > best.score) best = { score: sc, url: canvas.toDataURL('image/jpeg', 0.85) };
      }
      setProgress(Math.min(1, (performance.now() - t0) / VIDEO_MS));
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

  async function run() {
    const rounds = testMode ? 1 : ROUNDS;
    for (let r = 1; r <= rounds && alive.current; r++) {
      const tStart = performance.now();
      setRound(r);
      setPhase('scanning');
      let frames, opts = {};
      if (isVideo) {
        const { still, clip } = await recordClip();
        frames = still ? [still] : [];
        if (clip) opts = { video: clip, fps: vfps };
      } else {
        frames = await grab();
      }
      if (!alive.current || !frames.length) return;
      const captureMs = Math.round(performance.now() - tStart);
      scanFrames.set(frames[0], frames.slice(1));
      if (!machineId) { finish(frames[0]); return; } // not on a machine page: let the caller read it
      setPhase('reading');
      const result = await readScoreFromPhoto(frames[0], { id: machineId }, opts);
      if (!alive.current) return;
      if (testMode) {
        alive.current = false;
        stream.current?.getTracks().forEach(t => t.stop());
        onResult?.({ frame: frames[0], result, ms: Math.round(performance.now() - tStart), captureMs, uploadKB: Math.round(frames.reduce((t, f) => t + f.length, 0) * 0.75 / 1024) + (opts.video ? Math.round(opts.video.length * 0.75 / 1024) : 0), mode: isVideo ? 'video' : 'frames', fps: isVideo ? vfps : null, clipSent: !!opts.video });
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

  const label =
    phase === 'starting' ? 'Starting camera…'
    : phase === 'aiming' ? `Aim at the scores… ${count}`
    : phase === 'scanning' ? (round > 1 ? 'Watching for the scores…' : 'Hold on the scores… tilt the phone slightly')
    : phase === 'reading' ? 'Reading the scores…'
    : phase === 'waiting' ? 'Waiting for the scores screen…'
    : "Couldn't spot the scores";

  return (
    <div className="scanner" role="dialog" aria-label="Scan the score display">
      <video ref={video} className="scanner-video" playsInline muted />
      <div ref={box} className={`scanner-frame ${guide.shape}${phase === 'reading' ? ' reading' : ''}`} />
      <div className="scanner-top">
        <div className="scanner-hint">
          {guide.aim}
          <div className="scanner-hint-sub">{guide.note || 'Tilt the phone a little while it scans to dodge glare.'}</div>
          {(testMode || FLAG) && <span className="scanner-badge">{isVideo ? `VIDEO · ${vfps} fps` : 'FRAMES'}{testMode ? ' · TEST' : ''}</span>}
        </div>
        <button type="button" className="scanner-x" onClick={() => { alive.current = false; onCancel(); }} aria-label="Cancel">✕</button>
      </div>
      <div className="scanner-bottom">
        <div className="scanner-tip">{label}</div>
        {(phase === 'scanning' || phase === 'reading') && (
          <div className={`scanner-bar${phase === 'reading' ? ' pulse' : ''}`}><span style={{ width: `${phase === 'reading' ? 100 : Math.round(progress * 100)}%` }} /></div>
        )}
        {phase === 'waiting' && (
          <div className="muted small scanner-sub">
            {msg && /high|attract|not visible|champion/i.test(msg) ? 'The display is showing something else right now. ' : ''}
            Keep pointing at it. Many machines cycle back to the scores.
          </div>
        )}
        {phase === 'gaveup' ? (
          <>
            <div className="muted small scanner-sub">Tip: scan right after the game ends, while the final scores are up.</div>
            <button type="button" className="scanner-go" onClick={retry}>↻ Scan again</button>
            <button type="button" className="linkbtn small scanner-alt" onClick={() => { alive.current = false; onCancel(); }}>Type it instead</button>
          </>
        ) : (
          <button type="button" className="linkbtn small scanner-alt" onClick={() => { alive.current = false; onFallback(true); }}>Use a regular photo instead</button>
        )}
      </div>
    </div>
  );
}
