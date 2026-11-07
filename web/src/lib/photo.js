// Score-photo helpers: shrink a camera photo, then have the read-score edge function
// (Supabase + Gemini) save it as proof and read every player's score off the display.
import { SUPABASE_URL, SUPABASE_KEY, getToken } from './store.js';

// Shrink a camera photo to a JPEG data URL suitable for upload (~150–300 KB).
export async function photoToJpeg(file, maxSide = 1280, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// The photo's saved copy (proof), keyed by the data URL, so submitScore can attach it.
export const photoPaths = new Map();
// Extra frames from a live scan, keyed by the best frame's data URL.
export const scanFrames = new Map();
// Reads the live scanner already did, keyed by the frame it hands back (avoids a second AI call).
export const readCache = new Map();

// Sends the photo to the read-score function. Resolves to
//   { scores: [{ slot, value }], confidence: 'high'|'low', note, photoPath }
// or null if the service is unreachable (the UI then falls back to the keypad).
export async function readScoreFromPhoto(jpegDataUrl, machine, opts = {}) {
  if (readCache.has(jpegDataUrl)) return readCache.get(jpegDataUrl);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 40000); // never leave "Reading…" hanging
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/read-score`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify({ token: getToken(), machine_id: machine.id, image: jpegDataUrl, extra: scanFrames.get(jpegDataUrl) ?? [], video: opts.video, fps: opts.fps }),
    });
    const data = await res.json().catch(() => null);
    if (!data) return null;
    if (data.photoPath) photoPaths.set(jpegDataUrl, data.photoPath);
    if (data.error) return { scores: [], confidence: 'low', note: data.error, photoPath: null };
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
