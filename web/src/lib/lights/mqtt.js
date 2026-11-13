// One shared MQTT connection (secure WebSocket) to the public broker the WLED controller listens to.
// Light commands are fire-and-forget: if the broker or the controller is down, nothing in the party
// app waits on it or shows an error.
//
// The channel name (the controller's "device topic") is a secret: it is NOT in this code. A browser
// learns it once from the database with the host passcode (ensureLightsTopic in store.js) and keeps
// it in localStorage; until then, nothing is sent to or heard from the real controller.
//
// Topics (under the secret channel):
//   /api       JSON state for the real controller (WLED reads this)
//   /sim       the same commands in simulator-only (dry-run) mode; WLED ignores it
//   /status    WLED's own "online"/"offline" (retained)
//   /director  heartbeat from the TV that drives the lights (retained JSON)
//   /control   host commands for the TV to carry out (house lights, tests, brightness…)
// A topic starting with "~/" is used as written (the simulator's private throwaway channels).
import mqtt from 'mqtt';
import { LIGHTS } from './config.js';
import { calPayload } from './colorCal.js';

const TOPIC_KEY = 'pw.lightsTopic';
let base = (() => { try { return localStorage.getItem(TOPIC_KEY) || null; } catch { return null; } })();
const topicFns = new Set();
export const lightsTopic = () => base;
export function onLightsTopic(fn) { topicFns.add(fn); return () => topicFns.delete(fn); }

let client = null;
const handlers = new Map(); // sub → Set(fn)
const full = sub => (sub.startsWith('~/') ? sub.slice(2) : base ? `${base}/${sub}` : null);

export function setLightsTopic(tp) {
  if (!tp || tp === base) return;
  const old = [...handlers.keys()].map(full).filter(Boolean);
  base = tp;
  try { localStorage.setItem(TOPIC_KEY, tp); } catch { /* private window */ }
  if (client?.connected) {
    for (const o of old) { try { client.unsubscribe(o); } catch { /* ignore */ } }
    for (const s of handlers.keys()) { const f = full(s); if (f) client.subscribe(f); }
  }
  for (const fn of topicFns) { try { fn(tp); } catch { /* ignore */ } }
}

function connect() {
  if (client) return client;
  client = mqtt.connect(LIGHTS.broker, {
    clientId: `wp-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
    clean: true,
    queueQoSZero: false, // after a Wi-Fi blip, don't replay a burst of stale flashes
  });
  client.on('message', (topic, buf) => {
    let msg = buf.toString();
    try { msg = JSON.parse(msg); } catch { /* plain text, e.g. "online" */ }
    for (const [sub, fns] of handlers) {
      if (full(sub) !== topic) continue;
      for (const fn of fns) { try { fn(msg, topic); } catch { /* ignore */ } }
    }
  });
  client.on('connect', () => { for (const s of handlers.keys()) { const f = full(s); if (f) client.subscribe(f); } });
  client.on('error', () => { /* reconnects on its own */ });
  return client;
}

export function publish(sub, payload, { retain = false } = {}) {
  try {
    const topic = full(sub);
    if (!topic) return; // channel not known on this browser yet
    const c = connect();
    // Only the real controller gets warm-corrected colors (the simulator topics keep the intended ones).
    const out = sub === 'api' && typeof payload === 'object' ? calPayload(payload) : payload;
    const body = typeof out === 'string' ? out : JSON.stringify(out);
    c.publish(topic, body, { qos: 0, retain });
  } catch { /* fire and forget */ }
}

export function subscribe(sub, fn) {
  const c = connect();
  if (!handlers.has(sub)) {
    handlers.set(sub, new Set());
    const f = full(sub);
    if (f && c.connected) c.subscribe(f);
  }
  handlers.get(sub).add(fn);
  return () => {
    const set = handlers.get(sub);
    set?.delete(fn);
    if (set && !set.size) {
      handlers.delete(sub);
      const f = full(sub);
      if (f) { try { c.unsubscribe(f); } catch { /* ignore */ } }
    }
  };
}

export function onConnection(fn) {
  const c = connect();
  const up = () => fn(true), down = () => fn(false);
  c.on('connect', up); c.on('close', down); c.on('offline', down);
  fn(c.connected);
  return () => { c.off('connect', up); c.off('close', down); c.off('offline', down); };
}
