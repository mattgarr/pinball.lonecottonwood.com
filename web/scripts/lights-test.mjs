// Fire one light effect from the command line.
//   npm run lights:test -- --machine whirlwind --event score --color magenta          (simulator only)
//   npm run lights:test -- --machine whirlwind --event champion --color cyan --hardware (the real strips)
// Events: score, champion, leader, open, close, house, house-off, reveal, ambient.
// Watch it on /lights-sim (open it first).
// The channel is secret: set LIGHTS_TOPIC to the Device Topic shown on the host lights card.
import mqtt from 'mqtt';
import { LIGHTS } from '../src/lib/lights/config.js';
import { LightsEngine } from '../src/lib/lights/engine.js';
import { calPayload } from '../src/lib/lights/colorCal.js';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(s => {
  const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ') || true];
}));
const MACHINES = { centaur: 1, fathom: 2, whirlwind: 3, whitewater: 4, 'white water': 4, cactus: 5, 'cactus canyon': 5, dnd: 6, 'd&d': 6, dungeons: 6 };
const COLORS = { magenta: [255, 0, 170, 0], cyan: [0, 229, 255, 0], lime: [124, 255, 0, 0], orange: [255, 122, 0, 0], yellow: [255, 230, 0, 0], red: [255, 26, 26, 0], blue: [41, 98, 255, 0], pink: [255, 102, 196, 0], teal: [0, 255, 179, 0], violet: [157, 77, 255, 0], gold: [255, 179, 0, 0], sky: [102, 204, 255, 0] };
const machineId = MACHINES[String(args.machine || 'whirlwind').toLowerCase()] ?? Number(args.machine);
const color = COLORS[String(args.color || 'magenta').toLowerCase()] || COLORS.magenta;
const dry = !!process.env.LIGHTS_DRY_RUN;
const base = process.env.LIGHTS_TOPIC || (dry ? 'wp/dry-run' : '');
if (!base) { console.error('Set LIGHTS_TOPIC to the Device Topic from the host lights card.'); process.exit(1); }
const topic = `${base}/${args.hardware ? 'api' : 'sim'}`;

const client = dry ? null : mqtt.connect(LIGHTS.broker.replace('wss://', 'wss://'), { clientId: `wp-cli-${Date.now()}` });
const send = raw => { const msg = args.hardware ? calPayload(raw) : raw; console.log(`→ ${topic}`, JSON.stringify(msg)); client?.publish(topic, JSON.stringify(msg)); };
const go = () => {
  const e = new LightsEngine({ send });
  const ev = String(args.event || 'score');
  if (ev === 'score') e.score(machineId, color);
  else if (ev === 'champion') e.champion(machineId, color);
  else if (ev === 'leader') e.leader(color);
  else if (ev === 'open') e.partyOpen();
  else if (ev === 'close' || ev === 'ambient') e.stop();
  else if (ev === 'house') e.setHouse(true);
  else if (ev === 'house-off') e.setHouse(false);
  else if (ev === 'reveal') e.revealCue({ color, final: true });
  setTimeout(() => { e.destroy(); client?.end(); process.exit(0); }, ev === 'reveal' ? 7000 : 6000);
};
if (dry) go(); else client.on('connect', go);
