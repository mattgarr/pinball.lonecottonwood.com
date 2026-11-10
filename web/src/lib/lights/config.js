// Lights config: one WLED controller (Gledopto) in the garage, two LED runs, six machine zones per run.
// The app reaches the controller through a public MQTT broker (WLED subscribes to it over the garage
// WiFi; browsers connect over secure WebSockets). Only the TV page "drives" the lights, so a stray
// /tv on someone's phone never doubles a flash.
//
// WLED setup (Config > Sync Interfaces > MQTT): broker broker.hivemq.com, port 1883, no user/pass,
// Device topic = TOPIC below. Commands go to `${TOPIC}/api` as JSON state (same body as POST /json/state).

export const LIGHTS = {
  broker: 'wss://broker.hivemq.com:8884/mqtt',
  topic: 'woodsidepinball/0574bee021207a68cb', // long and random: nobody stumbles onto the lights
  competitorMode: 'individual', // 'team' would color by team (no teams at this party)

  // Physical order, left to right, as machine ids from the machines table.
  // Fathom, Centaur, Whirlwind, Whitewater, Cactus Canyon, Dungeons & Dragons.
  machineOrder: [2, 1, 3, 4, 5, 6],

  // Pixel numbering runs across both outputs: the top run first, then the curb run.
  // These are estimates until the strips are on the wall; the calibration page saves the real zones.
  //
  // The curb is treated as a second row of pixels directly under the loft beam: each machine gets the
  // same number of pixels on the curb as on the beam, and the curb copies the beam pixel above it.
  // How: segment 1 covers the whole beam; the curb's segment 8 is made the same length as the beam
  // (WLED's output 2 is set to the beam's length; the pixels past the real 20 ft simply don't exist),
  // and its "offset" shifts the pattern so curb pixel k shows what the beam pixel above it shows.
  // Same effect + same length + same start time = identical, stacked. Seams fall only at the wall corners.
  //
  // Segments (higher ids draw on top in WLED):
  //   0 whole top run (walls + beam) · 1 the loft beam · 2–7 top machine zones
  //   8 curb (beam length, offset) · 9–14 curb machine zones · 15 calibration pointer
  //
  // WLED LED setup: output 1 = top run length; output 2 = the BEAM's length (not the curb's 85).
  runs: {
    top: { start: 0, stop: 235, baseSeg: 0, bandSeg: 1, firstMachineSeg: 2,
      sections: [{ name: 'Left wall', len: 43 }, { name: 'Loft beam', len: 149 }, { name: 'Right wall', len: 43 }] },
    curb: { start: 235, stop: 320, baseSeg: 8, firstMachineSeg: 9 },
  },
  pointerSeg: 15, // temporary one-pixel pointer used by the calibration page
  // Default width of the six machines together, in pixels (14/m): about 2.75 ft per machine → ~16.5 ft.
  // Calibration replaces this with the real positions.
  machineSpanPx: 70,

  // The state the ambient layers (walls, beam band, curb) return to after an effect (and on party open).
  partyBase: { fx: 'Colorloop', sx: 60, ix: 128, bri: 170, col: [[157, 77, 255, 0], [0, 229, 255, 0], [255, 0, 170, 0]] },
  // ...and it rotates through these so the room doesn't get repetitive (all layers switch together).
  // pal = WLED palette number: 6 Party, 50 Aurora, 56 Retro Clown, 57 Candy.
  ambientCycle: [
    { fx: 'Colorwaves', pal: 6, sx: 90, ix: 128 },
    { fx: 'Plasma', pal: 57, sx: 70, ix: 128 },
    { fx: 'Pacifica', sx: 100, ix: 128 },
    { fx: 'Flow', pal: 6, sx: 80, ix: 128 },
    { fx: 'Aurora', pal: 50, sx: 90, ix: 128 },
    { fx: 'Twinklefox', pal: 56, sx: 100, ix: 160 },
    { fx: 'Pride 2015', sx: 70, ix: 128 },
  ],
  ambientMinutes: 3, // how long each ambient effect runs
  ambientBri: 170,
  // Full flashes on the strips' dedicated white chip for exciting moments (never faster than 3/s).
  whiteFlash: { champion: true, leader: true },
  scoreAlsoOnTop: false, // score pulses light only the curb zone behind the machine

  // WLED keeps effect IDs fixed across versions; MQTT can't fetch the list, so they're named here.
  // IDs checked against WLED's FX.h (same in 0.14 and 0.15).
  effects: { Solid: 0, Blink: 1, Breathe: 2, Wipe: 3, Sweep: 6, Colorloop: 8, Rainbow: 9, Fade: 12, Chase: 28, 'Chase Rainbow': 30,
    Aurora: 38, 'Pride 2015': 63, Colorwaves: 67, Twinklefox: 80, Plasma: 97, Pacifica: 101, Flow: 110,
    // Sound-reactive (need the AudioReactive usermod and the Gledopto's mic turned on)
    Gravcentric: 157, Gravimeter: 132, Waterfall: 140, Freqwave: 137, 'DJ Light': 159, Puddlepeak: 144, Pixelwave: 129 },

  // Music mode: the ambient layers (walls, beam band, curb) run one of these instead of the party
  // base, in sync; score / champion / leader flashes still play on top.
  music: {
    Gravcentric: { label: 'VU meter from the center', sx: 128, ix: 128 },
    Waterfall: { label: 'Waterfall of the beat', sx: 200, ix: 128 },
    Freqwave: { label: 'Color by pitch', sx: 128, ix: 128 },
    'DJ Light': { label: 'DJ light', sx: 128, ix: 128 },
    Puddlepeak: { label: 'Splashes on the beat', sx: 128, ix: 128 },
  },

  houseWhite: [0, 0, 0, 255], // the strip's dedicated white chip
  ambientPreset: 1, // Matt's Arcade Attract playlist; the app never writes presets
};

// Default machine zones: the machines' span centered on the loft beam, and the same widths centered
// on the curb (so the curb sits directly under the machines on the beam).
export function defaultZones(cfg = LIGHTS) {
  const n = cfg.machineOrder.length;
  const curbLen = cfg.runs.curb.stop - cfg.runs.curb.start;
  const span = Math.min(cfg.machineSpanPx || curbLen, curbLen);
  const [left, beam] = cfg.runs.top.sections;
  const topStart = cfg.runs.top.start + left.len + Math.max(0, Math.floor((beam.len - span) / 2));
  const widths = cfg.machineOrder.map((_, i) => Math.round((span * (i + 1)) / n) - Math.round((span * i) / n));
  const top = alignZones(cfg, topStart, widths);
  return { top, curb: stackUnder(top, cfg.runs.curb.start + Math.floor((curbLen - span) / 2)) };
}

// Zones from a start pixel and a width per machine (in physical order).
export function alignZones(cfg, start, widths) {
  let at = start;
  return cfg.machineOrder.map((id, i) => { const z = { machineId: id, start: at, stop: at + widths[i] }; at += widths[i]; return z; });
}

// The curb zones: the same width as each top zone, starting at the curb's first machine edge.
export function stackUnder(topZones, curbStart) {
  const shift = curbStart - topZones[0].start;
  return topZones.map(z => ({ machineId: z.machineId, start: z.start + shift, stop: z.stop + shift }));
}

// From the first machine edge to the last.
export const spanOf = zones => ({ start: zones[0].start, stop: zones[zones.length - 1].stop });

// The loft beam's pixels on the top run.
export function beamOf(cfg = LIGHTS) {
  const [left, beam] = cfg.runs.top.sections;
  const start = cfg.runs.top.start + left.len;
  return { start, stop: start + beam.len, len: beam.len };
}

// Where the curb sits under the beam: curb pixel k is under beam pixel (curbOffset + k), found by
// lining up the first machine's edge on both runs.
export function curbOffset(zones, cfg = LIGHTS) {
  return (zones.top[0].start - beamOf(cfg).start) - (zones.curb[0].start - cfg.runs.curb.start);
}

// The stretch of the beam directly above the real curb strip (for drawing the simulator).
export function bandOf(zones, cfg = LIGHTS) {
  const start = beamOf(cfg).start + curbOffset(zones, cfg);
  return { start, stop: start + (cfg.runs.curb.stop - cfg.runs.curb.start) };
}

// '#ff5b6e' → [255, 91, 110, 0] (W stays 0: white is reserved for house lights).
export function hexToRgbw(hex) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return [255, 0, 170, 0];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 0];
}
