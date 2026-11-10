// A stand-in for the WLED controller: logs every command the app sends (real and simulator topics).
//   npm run lights:mock
import mqtt from 'mqtt';
import { LIGHTS } from '../src/lib/lights/config.js';

const base = process.env.LIGHTS_TOPIC; // the Device Topic from the host lights card
if (!base) { console.error('Set LIGHTS_TOPIC to the Device Topic from the host lights card.'); process.exit(1); }
const c = mqtt.connect(LIGHTS.broker, { clientId: `wp-mock-${Date.now()}` });
c.on('connect', () => {
  console.log(`Mock WLED listening on ${base}/api and /sim (Ctrl+C to stop)`);
  c.subscribe([`${base}/api`, `${base}/sim`, `${base}/control`]);
});
c.on('message', (t, buf) => {
  const sub = t.split('/').pop();
  setTimeout(() => console.log(new Date().toLocaleTimeString(), `[${sub}]`, buf.toString()), 300); // ~300 ms like a real controller
});
