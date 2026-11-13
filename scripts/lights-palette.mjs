// Build the corrected rainbow palette and upload it to the controller as custom palette 0 (pal 255).
// Usage: node scripts/lights-palette.mjs [controller-ip]   (default 192.168.1.234)
import { rainbowPalette } from '../web/src/lib/lights/colorPalette.js';
const ip = process.argv[2] || '192.168.1.234';
const fd = new FormData();
fd.append('data', new Blob([JSON.stringify(rainbowPalette())], { type: 'application/json' }), 'palette0.json');
const r = await fetch(`http://${ip}/upload`, { method: 'POST', body: fd });
console.log(r.status, (await r.text()).slice(0, 60));
