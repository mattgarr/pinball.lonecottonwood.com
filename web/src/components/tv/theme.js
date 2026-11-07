import { machineArt, machineSlug } from '../../lib/machineArt.js';

// Backbox "lamp" colour per machine — tuned to each backglass's dominant palette.
const GLOW = {
  'centaur': '#ff3b2f',
  'fathom': '#18c6ff',
  'whirlwind': '#4f9dff',
  'white-water': '#22e0c2',
  'cactus-canyon': '#ff9a1f',
  'dungeons-dragons': '#b356ff',
};
export const machineGlow = name => GLOW[machineSlug(name)] || '#ffb02e';

export { machineArt };

// <img onError> helper: if the backglass photo is missing, fall back to the bundled SVG once.
export function artFallback(e, name) {
  const svg = `/machines/${machineSlug(name)}.svg`;
  const img = e.currentTarget;
  if (!img.src.endsWith(svg)) img.src = svg;
}

// Short machine labels for tight spots (ticker chips).
const SHORT = { 'dungeons-dragons': 'D&D', 'cactus-canyon': 'Cactus Canyon', 'white-water': 'White Water' };
export const machineShort = name => SHORT[machineSlug(name)] || name;
