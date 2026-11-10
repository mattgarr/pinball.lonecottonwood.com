// The lights' master dimmer: WLED's own brightness (top-level "bri"), which scales everything the
// strips show (ambient looks, app moments, presets, the remote's shows). The app never lowers it on its
// own: every look runs at full segment brightness and no preset sets "bri", so the dimmer stays put.
//
// Where the level lives: a retained MQTT message on `<channel>/dimmer` ({ value, at }), so whoever
// connects next (the TV after a reload, the host page on a phone) learns the current level, and the
// TV puts it back after a controller reboot. WLED also announces its brightness on `<channel>/g`
// whenever it changes (the remote's brightness buttons, WLED's own app), and the TV keeps the
// retained level in step with that, so the last change from anywhere wins.
import { publish, subscribe } from './mqtt.js';

const KEY = 'pw.lightsDimmer'; // this browser's last known level, shown before the broker answers
export const DIMMER_DEFAULT = 255;

export const clampDimmer = v => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(255, n) : null;
};
export const dimmerPct = v => Math.max(1, Math.round(((clampDimmer(v) ?? DIMMER_DEFAULT) / 255) * 100));

// This browser's last known level, or null if it has never heard one.
export function cachedDimmer() {
  try { return clampDimmer(localStorage.getItem(KEY)); } catch { return null; }
}
function cache(v) { try { localStorage.setItem(KEY, String(v)); } catch { /* private window */ } }

// Remember a new level for everyone (retained). The caller also applies it to the lights.
export function saveDimmer(v) {
  const value = clampDimmer(v);
  if (!value) return null;
  cache(value);
  publish('dimmer', { value, at: Date.now() }, { retain: true });
  return value;
}

// Watch the level: the retained setting and WLED's own reports. fn(value, source) with source
// 'saved' (someone set the dimmer) or 'wled' (the controller says so). WLED reports 0 while off: ignored.
export function watchDimmer(fn) {
  const a = subscribe('dimmer', m => {
    const v = clampDimmer(m && typeof m === 'object' ? m.value : m);
    if (v) { cache(v); fn(v, 'saved'); }
  });
  const b = subscribe('g', m => {
    const v = clampDimmer(m);
    if (v) fn(v, 'wled');
  });
  return () => { a(); b(); };
}

// The TV (lights driver): apply the saved level, and follow changes made on the remote.
// In simulator-only mode the real controller's reports are ignored (it isn't the one being driven).
export const ECHO_MS = 3000; // WLED's report of our own change can lag; don't mistake it for the remote
export function followDimmer(engine, { dry = false } = {}) {
  return watchDimmer((v, src) => {
    if (src === 'saved') { if (v !== engine.dimmer) engine.setDimmer(v); return; }
    if (dry || v === engine.dimmer || Date.now() - engine.dimmerSentAt < ECHO_MS) return;
    // The controller changed brightness itself (remote / WLED app): remember it, don't echo it back.
    engine.setDimmer(v, { send: false });
    saveDimmer(v);
  });
}
