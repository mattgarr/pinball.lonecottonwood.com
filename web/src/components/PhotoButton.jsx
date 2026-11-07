import { useState } from 'react';
import { photoToJpeg } from '../lib/photo.js';

// Opens the rear camera (falls back to the photo library on desktop). A <label> wrapping the
// input is the most reliable way to open the camera on iOS Safari.
// onPhoto(jpegDataUrl) is called with a downscaled JPEG.
export default function PhotoButton({ onPhoto, onError, className = 'snap-btn', children, disabled }) {
  const [busy, setBusy] = useState(false);
  async function onChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try { onPhoto(await photoToJpeg(file)); }
    catch { onError?.("Couldn't open that photo. Try again, or type the score."); }
    finally { setBusy(false); }
  }
  return (
    <label className={`${className}${disabled || busy ? ' is-disabled' : ''}`} aria-disabled={disabled || busy}>
      <input type="file" accept="image/*" capture="environment" onChange={onChange} disabled={disabled || busy} hidden />
      {busy ? <span>Opening photo…</span> : children}
    </label>
  );
}
