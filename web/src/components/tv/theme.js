import { machineArt, machineSlug } from '../../lib/machineArt.js';
import { LIGHTS } from '../../lib/lights/config.js';

// Each machine's colors come from the garage lights' theme (lib/lights/config.js), so a machine
// lighting up looks the same on the TV and on the wall. RGBW → screen: the white chip adds white.
const hex = ([r, g, b, w = 0]) => '#' + [r + w, g + w, b + w].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('');
const THEMES = Object.fromEntries(Object.values(LIGHTS.machineThemes).map(t => [machineSlug(t.name), t.colors.map(hex)]));
// [main, second, third] for a machine.
export const machineColors = name => THEMES[machineSlug(name)] || ['#ffb02e', '#ff6a00', '#ffd84d'];
export const machineGlow = name => machineColors(name)[0];

export { machineArt };

// <img onError> helper: if the backglass photo is missing, fall back to the bundled SVG once.
export function artFallback(e, name) {
  const svg = `/machines/${machineSlug(name)}.svg`;
  const img = e.currentTarget;
  if (!img.src.endsWith(svg)) img.src = svg;
}

// Short machine labels for tight spots (ticker chips).
const SHORT = { 'dungeons-dragons': 'D&D', 'cactus-canyon': 'Cactus Canyon', 'white-water': 'Whitewater' };
export const machineShort = name => SHORT[machineSlug(name)] || name;
