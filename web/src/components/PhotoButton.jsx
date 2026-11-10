import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { photoToJpeg } from '../lib/photo.js';
import Scanner from './Scanner.jsx';

// "Snap the score": opens the live scanner (several frames over ~3 s, best for dot-matrix
// displays that cycle or flicker). Falls back to the phone's regular camera when live camera
// access isn't available. onPhoto(jpegDataUrl) gets the best frame; extra frames ride along
// in photo.js (scanFrames) so the reader can combine them.
const canScan = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

export default function PhotoButton({ onPhoto, onError, onType, className = 'snap-btn', children, disabled }) {
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [noLive, setNoLive] = useState(false); // live camera was refused: use the regular camera
  const [blocked, setBlocked] = useState(''); // shown right under the button
  const input = useRef(null);

  async function onChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try { onPhoto(await photoToJpeg(file)); }
    catch { onError?.("That photo didn't work — try another, or type it in."); }
    finally { setBusy(false); }
  }

  function start(e) {
    if (disabled || busy) return;
    setBlocked('');
    if (canScan() && !noLive) { e.preventDefault(); setScanning(true); }
    // else: the <label> click opens the regular camera via the hidden input
  }

  return (
    <>
      <label className={`${className}${disabled || busy ? ' is-disabled' : ''}`} aria-disabled={disabled || busy} onClick={start}>
        <input ref={input} type="file" accept="image/*" capture="environment" onChange={onChange} disabled={disabled || busy} hidden />
        {busy ? <span>Opening photo…</span> : children}
      </label>
      {blocked && <div className="photo-blocked" role="alert">{blocked}</div>}
      {scanning && createPortal(
        <Scanner
          onCancel={() => setScanning(false)}
          onType={onType ? () => { setScanning(false); onType(); } : undefined}
          onFallback={fromTap => {
            setScanning(false); setNoLive(true);
            if (fromTap) input.current?.click(); // must run inside the tap for iOS
            else setBlocked("Camera's blocked — tap Snap again to use your phone's camera app, or type it in.");
          }}
          onDone={frame => { setScanning(false); onPhoto(frame); }}
        />,
        document.body,
      )}
    </>
  );
}
