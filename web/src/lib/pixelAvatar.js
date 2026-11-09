// Gemini turns a selfie into an 8-bit portrait (edge function pixel-avatar).
// We shrink the result to a small PNG so it stays light in the database and renders with crisp pixels.
import { SUPABASE_URL, SUPABASE_KEY, getToken, getHostPass, actions, host } from './store.js';

export const AVATAR_PX = 64;
export const isPixelArt = src => typeof src === 'string' && src.startsWith('data:image/png');

async function callFn(body) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/pixel-avatar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.image) throw new Error(out.error || "Couldn't draw it right now.");
  return out.image;
}

// Gemini doesn't always center the person. The portrait has a plain solid background, so find the
// head (the topmost band of non-background pixels) and re-center the square on it.
// Returns { x, y, s, fill } in source pixels; fill = background color for any strip off the edge.
export function centerCrop(img) {
  const N = 128; // analyze a small copy: fast and plenty precise
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  const s0 = Math.min(img.width, img.height);
  const ox = (img.width - s0) / 2, oy = (img.height - s0) / 2;
  g.drawImage(img, ox, oy, s0, s0, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data;
  // background = median color along the top edge and the upper half of both sides
  // (the bottom corners are often shirt, so they're left out)
  const rs = [], gs = [], bs = [];
  const take = (x, y) => { const i = (y * N + x) * 4; rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); };
  for (let x = 0; x < N; x++) { take(x, 0); take(x, 1); }
  for (let y = 0; y < N / 2; y++) { take(0, y); take(1, y); take(N - 1, y); take(N - 2, y); }
  const med = a => a.sort((p, q) => p - q)[a.length >> 1];
  const br = med(rs), bg = med(gs), bb = med(bs);
  const fg = (x, y) => { const i = (y * N + x) * 4; return Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb) > 90; };
  // first row with a real chunk of subject = top of the head
  let top = -1;
  for (let y = 0; y < N && top < 0; y++) { let k = 0; for (let x = 0; x < N; x++) k += fg(x, y); if (k >= N * 0.04) top = y; }
  const fill = `rgb(${Math.round(br)},${Math.round(bg)},${Math.round(bb)})`;
  if (top < 0) return { x: ox, y: oy, s: s0, fill };
  // horizontal center of the head band (top of head down ~40% of the image)
  const xs = [];
  for (let y = top; y < Math.min(N, top + N * 0.4); y++) for (let x = 0; x < N; x++) if (fg(x, y)) xs.push(x);
  if (!xs.length) return { x: ox, y: oy, s: s0, fill };
  const cx = xs.reduce((a, v) => a + v, 0) / xs.length;
  // head width = a wide row of the head band (75th percentile of each row's left-to-right span)
  const spans = [];
  for (let y = top; y < Math.min(N, top + N * 0.4); y++) {
    let a = -1, z = -1;
    for (let x = 0; x < N; x++) if (fg(x, y)) { if (a < 0) a = x; z = x; }
    if (a >= 0) spans.push(z - a);
  }
  spans.sort((p, q) => p - q);
  const headW = spans[Math.floor(spans.length * 0.75)] || N * 0.5;
  // Re-center on the head. The square may hang off the image edge; that strip gets filled with the
  // (solid) background color, so it's invisible.
  // Tight crop like a game character portrait: zoom so the head is ~58% of the frame width
  // (Gemini draws heads at different sizes), with a sliver of headroom above the hair.
  const S = Math.min(N, Math.max(N * 0.55, headW / 0.58));
  const left = cx - S / 2;
  const y0 = Math.min(Math.max(top - S * 0.06, -S * 0.2), N - S * 0.8);
  const k = s0 / N;
  return { x: ox + left * k, y: oy + y0 * k, s: S * k, fill };
}

function shrink(src, px = AVATAR_PX) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      const r = centerCrop(img);
      const k = px / r.s;
      if (r.fill) { x.fillStyle = r.fill; x.fillRect(0, 0, px, px); }
      x.drawImage(img, -r.x * k, -r.y * k, img.width * k, img.height * k);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error("Couldn't draw it right now."));
    img.src = src;
  });
}

// Draw a portrait from a selfie without saving it (works before joining: no token needed).
export async function drawPortrait(selfieDataUrl) {
  const token = getToken();
  const body = token ? { token, image: selfieDataUrl } : { image: selfieDataUrl };
  let raw;
  try { raw = await callFn(body); }
  catch { raw = await callFn(body); } // one automatic retry: Gemini sometimes hiccups
  return shrink(raw);
}

// For the signed-in player: draw from a selfie data URL and save it.
export async function makeMyPixelAvatar(selfieDataUrl) {
  const art = await drawPortrait(selfieDataUrl);
  await actions.setMyAvatar(art);
  return art;
}

// For the host: redraw any player from their saved selfie.
export async function hostPixelize(playerId) {
  const art = await shrink(await callFn({ pass: getHostPass(), player_id: playerId }));
  await host.setAvatar(playerId, art);
  return art;
}
