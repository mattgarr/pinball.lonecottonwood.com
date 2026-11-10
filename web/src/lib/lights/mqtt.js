// One shared MQTT connection (secure WebSocket) to the public broker the WLED controller listens to.
// Light commands are fire-and-forget: if the broker or the controller is down, nothing in the party
// app waits on it or shows an error.
//
// Topics (all under LIGHTS.topic):
//   /api       JSON state for the real controller (WLED reads this)
//   /sim       the same commands in simulator-only (dry-run) mode; WLED ignores it
//   /status    WLED's own "online"/"offline" (retained)
//   /director  heartbeat from the TV that drives the lights (retained JSON)
//   /control   host commands for the TV to carry out (house lights, tests, brightness…)
import mqtt from 'mqtt';
import { LIGHTS } from './config.js';

let client = null;
const handlers = new Map(); // full topic → Set(fn)

function connect() {
  if (client) return client;
  client = mqtt.connect(LIGHTS.broker, {
    clientId: `wp-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
    clean: true,
  });
  client.on('message', (topic, buf) => {
    const fns = handlers.get(topic);
    if (!fns) return;
    let msg = buf.toString();
    try { msg = JSON.parse(msg); } catch { /* plain text, e.g. "online" */ }
    for (const fn of fns) { try { fn(msg, topic); } catch { /* ignore */ } }
  });
  client.on('connect', () => { for (const t of handlers.keys()) client.subscribe(t); });
  client.on('error', () => { /* reconnects on its own */ });
  return client;
}

export const t = sub => `${LIGHTS.topic}/${sub}`;

export function publish(sub, payload, { retain = false } = {}) {
  try {
    const c = connect();
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    c.publish(t(sub), body, { qos: 0, retain });
  } catch { /* fire and forget */ }
}

export function subscribe(sub, fn) {
  const c = connect();
  const topic = t(sub);
  if (!handlers.has(topic)) { handlers.set(topic, new Set()); if (c.connected) c.subscribe(topic); }
  handlers.get(topic).add(fn);
  return () => {
    const set = handlers.get(topic);
    set?.delete(fn);
    if (set && !set.size) { handlers.delete(topic); try { c.unsubscribe(topic); } catch { /* ignore */ } }
  };
}

export function onConnection(fn) {
  const c = connect();
  const up = () => fn(true), down = () => fn(false);
  c.on('connect', up); c.on('close', down); c.on('offline', down);
  fn(c.connected);
  return () => { c.off('connect', up); c.off('close', down); c.off('offline', down); };
}
