import { useEffect, useRef, useState } from 'react';
import { readCache, readScoreFromPhoto, scanFrames } from '../lib/photo.js';

// Point-and-wait score scanner. Opens the live camera and starts scanning by itself:
// grabs frames for ~3 s, keeps the sharpest few, asks the AI to combine them. If the display
// is showing a logo / high-score table instead of player scores, it keeps watching and retries
// (up to ROUNDS times). Dot-matrix screens cycle and flicker, which is why one photo isn't enough.
//
// onDone(frame) — best frame (data URL); its AI result is cached in photo.js so the caller's
//                 normal read returns instantly. Called with the read result even if empty.
// onFallback(fromTap) — use the phone's regular camera instead.
const SCAN_MS = 3000;
const EVERY_MS = 300;
const KEEP = 4;
const ROUNDS = 4;

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

export default function Scanner({ onDone, onFallback, onCancel }) {
  const video = useRef(null);
  const stream = useRef(null);
  const alive = useRef(true);
  const [phase, setPhase] = useState('starting'); // starting | scanning | reading | waiting | gaveup
  const [progress, setProgress] = useState(0);
  const [round, setRound] = useState(0);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (!alive.current) { s.getTracks().forEach(t => t.stop()); return; }
        stream.current = s;
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
        await sleep(700); // let auto-focus / exposure settle
        if (alive.current) run();
      } catch {
        if (alive.current) onFallback(false);
      }
    })();
    return () => { alive.current = false; stream.current?.getTracks().forEach(t => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function grab() {
    const v = video.current;
    const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    const W = Math.round(v.videoWidth * scale), H = Math.round(v.videoHeight * scale);
    const big = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const small = Object.assign(document.createElement('canvas'), { width: 160, height: Math.round(160 * H / W) });
    const bctx = big.getContext('2d'), sctx = small.getContext('2d', { willReadFrequently: true });
    const frames = [];
    const t0 = performance.now();
    while (alive.current && performance.now() - t0 < SCAN_MS) {
      bctx.drawImage(v, 0, 0, W, H);
      sctx.drawImage(big, 0, 0, small.width, small.height);
      frames.push({ score: sharpness(sctx, small.width, small.height), url: big.toDataURL('image/jpeg', 0.78) });
      setProgress(Math.min(1, (performance.now() - t0) / SCAN_MS));
      await sleep(EVERY_MS);
    }
    // Sharpest frames, spread across the scan (the screen may change mid-scan).
    const third = Math.ceil(frames.length / 3);
    const groups = [frames.slice(0, third), frames.slice(third, 2 * third), frames.slice(2 * third)];
    const picked = groups.map(g => [...g].sort((a, b) => b.score - a.score)[0]).filter(Boolean);
    const rest = frames.filter(f => !picked.includes(f)).sort((a, b) => b.score - a.score);
    return [...picked, ...rest].slice(0, KEEP).sort((a, b) => b.score - a.score).map(f => f.url);
  }

  async function run() {
    const machineId = machineIdFromUrl();
    for (let r = 1; r <= ROUNDS && alive.current; r++) {
      setRound(r);
      setPhase('scanning');
      const frames = await grab();
      if (!alive.current || !frames.length) return;
      scanFrames.set(frames[0], frames.slice(1));
      if (!machineId) { finish(frames[0]); return; } // not on a machine page: let the caller read it
      setPhase('reading');
      const result = await readScoreFromPhoto(frames[0], { id: machineId });
      if (!alive.current) return;
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
    : phase === 'scanning' ? (round > 1 ? 'Watching for the scores…' : 'Hold steady…')
    : phase === 'reading' ? 'Reading the scores…'
    : phase === 'waiting' ? 'Waiting for the scores screen…'
    : "Couldn't spot the scores";

  return (
    <div className="scanner" role="dialog" aria-label="Scan the score display">
      <video ref={video} className="scanner-video" playsInline muted />
      <div className={`scanner-frame${phase === 'reading' ? ' reading' : ''}`} />
      <div className="scanner-top">
        <div className="scanner-hint">Fit the <strong>score display</strong> in the box</div>
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
