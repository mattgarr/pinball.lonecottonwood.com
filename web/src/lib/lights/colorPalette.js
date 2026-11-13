// The controller's custom palette 0 (pal 255): a full rainbow, run through colorCal so it looks right
// on the real strip. WLED's custom palette file format: { palette: [pos, "rrggbb", pos, "rrggbb", …] }.
import { calColor } from './colorCal.js';

const hsv = h => { const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); }; return [f(5), f(3), f(1), 0]; };
const hex = c => c.slice(0, 3).map(x => x.toString(16).padStart(2, '0')).join('');

export function rainbowPalette({ stops = 16, calibrate = true } = {}) {
  const palette = [];
  for (let k = 0; k <= stops; k++) {
    const c = hsv((k * 360 / stops) % 360);
    palette.push(Math.round(k * 255 / stops), hex(calibrate ? calColor(c) : c));
  }
  return { palette };
}
