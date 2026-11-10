// Standalone light shows for the controller (WLED presets), for when the TV / app isn't running:
// flip the wall switch and the garage plays on its own. Built from the same config as the app, so
// the zones, the curb stacking and the cool palette match. Download from the host lights card and
// upload in WLED (Config → Security & Updates → Restore presets).
//
//   1 Attract   cycles the cool ambient effects, 3 min each (boot preset)
//   2 Calm      slow and dim
//   3 Exciting  fast and bright
//   4 Music     sound-reactive, from the controller's mic
//   5 House lights · 6 Off · 9 Next mode (cycles 1 → 4; for the controller's button)
// WLED's WiZmote remote maps buttons 1–4 to presets 1–4, so the remote's buttons are the four modes.
import { LIGHTS, defaultZones } from './config.js';
import { LightsEngine } from './engine.js';

const fx = name => LIGHTS.effects[name] ?? 0;
const cool = names => names.map(n => LIGHTS.coolColors[n]);

// The full segment layout (ids 0–14, ascending), with one state on the three base layers.
function layout(zones, state) {
  let segs = [];
  const eng = new LightsEngine({ send: p => { segs = p.seg || segs; }, zones });
  eng.applyLayout(zones); eng.flush(); eng.destroy();
  const { top, curb } = LIGHTS.runs;
  const base = [top.baseSeg, top.bandSeg, curb.baseSeg];
  return segs.map(s => (base.includes(s.id) ? { ...s, on: true, bri: 255, mi: false, rev: false, ...state } : { ...s, on: false }));
}

const show = (zones, n, bri, state) => ({ n, on: true, bri, transition: 15, seg: layout(zones, { sx: 128, ix: 128, pal: 0, ...state }) });
const playlist = (n, ps, seconds) => ({ n, on: true, playlist: { ps, dur: ps.map(() => seconds * 10), transition: ps.map(() => 20), repeat: 0 } });

export function buildPresets(zones = defaultZones()) {
  const p = { 0: {} };
  // Attract: the app's own ambient rotation.
  LIGHTS.ambientCycle.forEach((a, i) => {
    p[11 + i] = show(zones, `Attract: ${a.fx}`, LIGHTS.ambientBri ?? 170,
      { fx: fx(a.fx), sx: a.sx ?? 128, ix: a.ix ?? 128, pal: a.pal ?? 0, col: a.col ? cool(a.col) : LIGHTS.partyBase.col });
  });
  p[1] = playlist('Attract', LIGHTS.ambientCycle.map((_, i) => 11 + i), (LIGHTS.ambientMinutes || 3) * 60);

  // Calm: slow, dim, 5 min each.
  p[41] = show(zones, 'Calm: ocean', 90, { fx: fx('Pacifica'), sx: 40 });
  p[42] = show(zones, 'Calm: breathe', 90, { fx: fx('Breathe'), sx: 20, col: cool(['teal', 'purple']) });
  p[43] = show(zones, 'Calm: aurora', 90, { fx: fx('Aurora'), sx: 50, pal: 4, col: cool(['teal', 'purple', 'blue']) });
  p[2] = playlist('Calm', [41, 42, 43], 300);

  // Exciting: fast and bright, 1 min each.
  p[21] = show(zones, 'Exciting: waves', 220, { fx: fx('Colorwaves'), sx: 220, pal: 4, col: cool(['purple', 'pink', 'turquoise']) });
  p[22] = show(zones, 'Exciting: plasma', 220, { fx: fx('Plasma'), sx: 230, pal: 4, col: cool(['blue', 'pink', 'teal']) });
  p[23] = show(zones, 'Exciting: flow', 220, { fx: fx('Flow'), sx: 230, pal: 4, col: cool(['pink', 'purple', 'turquoise']) });
  p[24] = show(zones, 'Exciting: twinkle', 220, { fx: fx('Twinklefox'), sx: 200, ix: 230, pal: 4, col: cool(['pink', 'turquoise', 'purple']) });
  p[25] = show(zones, 'Exciting: chase', 220, { fx: fx('Chase'), sx: 220, col: cool(['purple', 'turquoise', 'pink']) });
  p[3] = playlist('Exciting', [21, 22, 23, 24, 25], 60);

  // Music: the sound-reactive effects, 45 s each.
  Object.entries(LIGHTS.music).forEach(([name, m], i) => {
    p[31 + i] = show(zones, `Music: ${m.label}`, 220, { fx: fx(name), sx: m.sx, ix: m.ix, pal: 4, col: LIGHTS.partyBase.col });
  });
  p[4] = playlist('Music', Object.keys(LIGHTS.music).map((_, i) => 31 + i), 45);

  p[5] = show(zones, 'House lights', 255, { fx: fx('Solid'), col: [LIGHTS.houseWhite] });
  p[6] = { n: 'Off', on: false };
  p[9] = { n: 'Next mode', ps: '1~4~' }; // each press: Attract → Calm → Exciting → Music → Attract
  return p;
}
