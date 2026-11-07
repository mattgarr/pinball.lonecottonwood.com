// Thin wrapper around photo.js's readScoreFromPhoto():
//   • normalises the result to { scores: [{ slot, value|null }], confidence, note } or null
//   • never throws and never hangs (timeout → null → keypad fallback)
//   • `?fakephoto=1` (3 scores) / `?fakephoto=solo` (1 score) / `?fakephoto=fail` (null)
//     fakes a read so the flow can be tested without the Edge Function. The flag sticks for
//     the browser tab (sessionStorage); `?fakephoto=0` turns it off.
import { readScoreFromPhoto } from './photo.js';
import { rangeFor } from './plausibility.js';

const FLAG_KEY = 'pw.fakephoto';
function fakeMode() {
  try {
    const q = new URLSearchParams(window.location.search).get('fakephoto');
    if (q != null) {
      if (q === '0' || q === '') sessionStorage.removeItem(FLAG_KEY);
      else sessionStorage.setItem(FLAG_KEY, q);
    }
    return sessionStorage.getItem(FLAG_KEY);
  } catch { return null; }
}
// Call once at startup so the flag is captured before the router rewrites the URL.
export function captureFakeFlag() { fakeMode(); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fakeRead(machine, mode) {
  if (mode === 'fail') return null;
  const { min } = rangeFor(machine);
  const round = n => Math.round(n / 10) * 10;
  if (mode === 'solo') return { scores: [{ slot: 1, value: round(min * 7.3) }], confidence: 'high', note: 'Fake read (?fakephoto=solo)' };
  return {
    scores: [
      { slot: 1, value: round(min * 6.1) },
      { slot: 2, value: round(min * 2.4) },
      { slot: 3, value: null },
    ],
    confidence: 'low',
    note: 'Fake read (?fakephoto=1): Player 3 was blurry.',
  };
}

function normalise(r) {
  if (!r || typeof r !== 'object') return null;
  let scores = [];
  if (Array.isArray(r.scores)) {
    scores = r.scores
      .map((s, i) => ({ slot: Number(s?.slot) || i + 1, value: Number.isFinite(Number(s?.value)) && Number(s?.value) > 0 ? Math.round(Number(s.value)) : null }))
      .sort((a, b) => a.slot - b.slot);
  } else if (r.value != null) {
    // older single-score shape { value, candidates, confidence }
    scores = [{ slot: 1, value: Math.round(Number(r.value)) || null }];
  }
  if (!scores.length) return null;
  return { scores, confidence: r.confidence === 'high' ? 'high' : 'low', note: r.note || null };
}

export async function readScores(jpegDataUrl, machine) {
  const mode = fakeMode();
  if (mode) { await sleep(1600); return normalise(fakeRead(machine, mode)); }
  try {
    const r = await Promise.race([readScoreFromPhoto(jpegDataUrl, machine), sleep(15000).then(() => null)]);
    return normalise(r);
  } catch {
    return null;
  }
}
