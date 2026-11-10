// The server's clock, so the TV countdown matches the database's cutoff even if this device's
// clock is off. Synced at start and every 5 minutes; until then (or without server_now) it's local time.
import { useEffect, useState } from 'react';
import { bestOffset, clockOffset } from './schedule.js';

let offset = 0;
let started = false;

export const serverNow = () => Date.now() + offset;

async function sample(sb) {
  const t0 = Date.now();
  const { data, error } = await sb.rpc('server_now');
  const t1 = Date.now();
  if (error || !data) return null;
  return { offset: clockOffset(t0, t1, data), rtt: t1 - t0 };
}

export async function syncClock(sb) {
  try {
    const got = [];
    for (let i = 0; i < 3; i++) got.push(await sample(sb).catch(() => null));
    const o = bestOffset(got);
    if (o != null) offset = o;
  } catch { /* keep the last offset */ }
}

export function startClock(sb) {
  if (started) return;
  started = true;
  syncClock(sb);
  setInterval(() => { if (!document.hidden) syncClock(sb); }, 5 * 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncClock(sb); });
}

// Re-render every `ms` with the server time.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const iv = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(iv);
  }, [ms]);
  return now;
}
