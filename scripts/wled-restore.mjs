// One-step setup for a new / replacement garage-lights controller (WLED 0.14+).
// Run from the repo root once the controller is on the home Wi-Fi:
//   node scripts/wled-restore.mjs <controller-ip>            (e.g. 192.168.1.57)
//   node scripts/wled-restore.mjs <ip> --pin1 16 --pin2 12   (data pins, if the board labels differ)
//   node scripts/wled-restore.mjs <ip> --dry                 (print what would change, change nothing)
// It sets: LED outputs (top run + curb, SK6812 RGBW, BRG + swap W/G, 235 each), max current, 42 fps,
// gamma, boot preset 1 (Attract), MQTT (the app's private channel, read with the host passcode from
// HOST_PASSCODE.txt; never printed), the 3 AM auto-off, Pacific time, the button (short = next mode,
// double = house lights, long = off); then uploads the light shows (presets.json, from the saved zones)
// and the corrected rainbow (palette0.json), reboots, and checks the result.
import { readFileSync } from 'node:fs';
import { buildPresets } from '../web/src/lib/lights/presets.js';
import { rainbowPalette } from '../web/src/lib/lights/colorPalette.js';

const args = process.argv.slice(2);
const ip = args.find(a => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry');
if (!ip) { console.log('Usage: node scripts/wled-restore.mjs <controller-ip> [--pin1 16] [--pin2 12] [--dry]'); process.exit(1); }
const base = `http://${ip}`;
const SUPA = 'https://llmggdjxiffkwnjuogxf.supabase.co';
const KEY = 'sb_publishable_7oGSOVFpRFVnJ5SeRcjYsQ_a6EQyojv';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async p => (await fetch(base + p, { signal: AbortSignal.timeout(5000) })).json();
const post = async (p, body) => (await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) })).text();
async function upload(name, obj) {
  const fd = new FormData();
  fd.append('data', new Blob([JSON.stringify(obj)], { type: 'application/json' }), name);
  const r = await fetch(`${base}/upload`, { method: 'POST', body: fd, signal: AbortSignal.timeout(15000) });
  return `${r.status} ${(await r.text()).slice(0, 40)}`;
}
async function rpc(fn, body) {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${fn}: ${r.status}`);
  return r.json();
}

// 1. Reach the controller.
let info;
for (let i = 0; i < 20 && !info; i++) { try { info = await get('/json/info'); } catch { await sleep(1500); } }
if (!info) { console.log(`Can't reach ${base}. Is it on the home Wi-Fi? (Check the router or the WLED app for its address.)`); process.exit(1); }
console.log(`Found ${info.name || 'WLED'} ${info.ver} (${info.arch || ''}), ${info.leds?.count} LEDs configured.`);
const cfg = await get('/json/cfg');

// 2. The app's private lights channel and the saved machine zones.
const pass = readFileSync(new URL('../HOST_PASSCODE.txt', import.meta.url), 'utf8').split('\n')[2].trim();
const topic = await rpc('host_lights_topic', { p_pass: pass });
if (!topic) throw new Error('No lights channel returned (wrong host passcode?)');
const [{ zones } = {}] = await (await fetch(`${SUPA}/rest/v1/lights_settings?select=zones&id=eq.1`, { headers: { apikey: KEY } })).json();

// 3. Settings (a partial cfg: WLED merges it).
const pin1 = Number(opt('pin1', 16)), pin2 = Number(opt('pin2', 12));
const bus = (start, pin) => ({ start, len: 235, pin: [pin], order: 34, rev: false, skip: 0, type: 30, ref: false, rgbwm: 0, freq: 0 });
const btn = cfg.hw?.btn?.ins?.[0];
const patch = {
  id: { ...cfg.id, name: 'Garage lights', mdns: 'wled-garage' },
  hw: {
    led: { ...cfg.hw.led, maxpwr: 12000, fps: 42, ins: [bus(0, pin1), bus(235, pin2)] },
    ...(btn ? { btn: { ...cfg.hw.btn, ins: [{ ...btn, macros: [9, 8, 7] }, ...cfg.hw.btn.ins.slice(1)] } } : {}),
  },
  light: { ...cfg.light, gc: { bri: 1, col: 1, val: 2.8 } },
  def: { ps: 1, on: true, bri: 255 },
  if: {
    ...cfg.if,
    mqtt: { ...(cfg.if?.mqtt || {}), en: true, broker: 'broker.hivemq.com', port: 1883, user: '', psk: '', cid: 'wled-garage', topics: { device: topic, group: `${topic}g` } },
    ntp: { ...(cfg.if?.ntp || {}), en: true, tz: 8 },
  },
  timers: { ...(cfg.timers || {}), ins: [{ en: 1, hour: 3, min: 0, macro: 8, dow: 127, start: { mon: 1, day: 1 }, end: { mon: 12, day: 31 } }] },
};
const shown = JSON.parse(JSON.stringify(patch)); shown.if.mqtt.topics = { device: '(private)', group: '(private)' };
console.log('Settings to apply:', JSON.stringify({ outputs: patch.hw.led.ins.map(b => `pin ${b.pin[0]} @${b.start} x${b.len}`), maxpwr: 12000, fps: 42, boot: 'preset 1', mqtt: 'broker.hivemq.com (private channel)', autoOff: '3:00', button: btn ? 'short=next, double=house, long=off' : 'no button found: set in Time & Macros' }));
if (DRY) { console.log('Dry run: nothing changed.'); process.exit(0); }

console.log('cfg:', await post('/json/cfg', patch));
console.log('presets.json:', await upload('presets.json', buildPresets(zones || undefined)));
console.log('palette0.json (corrected rainbow):', await upload('palette0.json', rainbowPalette()));
console.log('Rebooting…');
try { await post('/json/state', { rb: true }); } catch { /* it drops the connection */ }
await sleep(8000);

// 4. Check.
let after;
for (let i = 0; i < 30 && !after; i++) { try { after = await get('/json/cfg'); } catch { await sleep(2000); } }
if (!after) { console.log('It did not come back yet: give it a minute, then check the WLED page.'); process.exit(1); }
const ins = after.hw.led.ins.map(b => `pin ${b.pin} @${b.start} x${b.len} type ${b.type} order ${b.order}`);
const ok = after.if.mqtt.en && after.if.mqtt.topics.device === topic && after.hw.led.ins.length === 2 && after.timers.ins?.[0]?.hour === 3;
console.log('Outputs:', ins.join(' | '));
console.log('MQTT on, private channel set:', after.if.mqtt.en && after.if.mqtt.topics.device === topic);
console.log('Auto-off 3 AM:', after.timers.ins?.[0]?.hour === 3, '· boot preset:', after.def?.ps);
await post('/json/state', { on: true, bri: 255, ps: 1 });
console.log(ok ? 'Done: Attract is playing. Run the color test (red, green, blue, white) to confirm the strip.' : 'Some settings did not stick: check the WLED pages.');
