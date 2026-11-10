// Lights config: one WLED controller (Gledopto) in the garage, two LED runs, six machine zones per run.
// The app reaches the controller through a public MQTT broker (WLED subscribes to it over the garage
// WiFi; browsers connect over secure WebSockets). Only the TV page "drives" the lights, so a stray
// /tv on someone's phone never doubles a flash.
//
// WLED setup (Config > Sync Interfaces > MQTT): broker broker.hivemq.com, port 1883, no user/pass,
// Device topic = the secret channel name (stored in the database, shown on the host lights card).
// Commands go to `<channel>/api` as JSON state (same body as POST /json/state).

export const LIGHTS = {
  broker: 'wss://broker.hivemq.com:8884/mqtt',
  competitorMode: 'individual', // 'team' would color by team (no teams at this party)

  // Physical order, left to right, as machine ids from the machines table.
  // Fathom, Centaur, Whirlwind, Whitewater, Cactus Canyon, Dungeons & Dragons.
  machineOrder: [2, 1, 3, 4, 5, 6],
  // Each machine's own colors (main color first). Machine effects pick from these: a score breathes
  // between the player's color and the main color; a champion chase alternates all three.
  machineThemes: {
    2: { name: 'Fathom', colors: [[0, 210, 120, 0], [0, 90, 240, 0], [140, 255, 220, 0]] }, // sea green, ocean blue, seafoam
    1: { name: 'Centaur', colors: [[255, 0, 25, 0], [90, 0, 18, 0], [10, 25, 45, 200]] }, // lipstick red, wine, chrome (W chip)
    3: { name: 'Whirlwind', colors: [[10, 90, 255, 0], [0, 30, 180, 0], [255, 220, 60, 0]] }, // electric blue, storm navy, lightning yellow
    4: { name: 'White Water', colors: [[0, 120, 255, 0], [20, 60, 70, 210], [255, 110, 0, 0]] }, // river blue, foam white (W chip), life-jacket orange
    5: { name: 'Cactus Canyon', colors: [[255, 190, 0, 0], [255, 80, 0, 0], [230, 20, 60, 0]] }, // sunset gold, deep orange, rose red
    6: { name: 'Dungeons & Dragons', colors: [[120, 0, 255, 0], [230, 0, 170, 0], [200, 150, 255, 0]] }, // purple, magenta, lavender
  },

  // Pixel numbering runs across both outputs: the top run first, then the curb run.
  // These are estimates until the strips are on the wall; the calibration page saves the real zones.
  //
  // The curb is treated as a second row of pixels directly under the loft beam: each machine gets the
  // same number of pixels on the curb as on the beam, and the curb copies the beam pixel above it.
  // How: the top run is one continuous segment (walls and beam flow together, no seam at the corners).
  // The curb's segment 8 is made the same length as the top run (WLED's output 2 is set to 235; the
  // pixels past the real 20 ft simply don't exist), and its "offset" shifts the pattern so curb pixel k
  // shows what the top pixel above it shows. Same effect + same length + same start time = stacked.
  //
  // Segments (higher ids draw on top in WLED):
  //   0 whole top run (walls + beam) · 1 same bounds as 0 · 2–7 top machine zones
  //   8 curb (top-run length, offset) · 9–14 curb machine zones · 15 calibration pointer
  //
  // WLED LED setup: output 1 = top run (235); output 2 = ALSO 235 (not the curb's real 85).
  runs: {
    top: { start: 0, stop: 235, baseSeg: 0, bandSeg: 1, firstMachineSeg: 2,
      sections: [{ name: 'Left wall', len: 43 }, { name: 'Loft beam', len: 149 }, { name: 'Right wall', len: 43 }] },
    curb: { start: 235, stop: 320, baseSeg: 8, firstMachineSeg: 9 },
  },
  pointerSeg: 15, // temporary one-pixel pointer used by the calibration page
  // Default width of the six machines together, in pixels (14/m): about 2.75 ft per machine → ~16.5 ft.
  // Calibration replaces this with the real positions.
  machineSpanPx: 84,

  // The state the ambient layers (walls, beam band, curb) return to after an effect (and on party open).
  partyBase: { fx: 'Colorwaves', pal: 4, sx: 90, ix: 128, bri: 255, col: [[140, 40, 255, 0], [255, 40, 170, 0], [0, 230, 210, 0]] },
  // ...and it rotates through these so the room doesn't get repetitive (all layers switch together).
  // A cool palette only (purple, blue, pink, teal, turquoise), no rainbows: pal 4 is WLED's
  // "Color Gradient", which blends the segment's three colors, so each effect gets its own mix.
  ambientCycle: [
    // Brightness (Nov 10): the strips are the garage's main light, so every look must light the room.
    // Each one's intensity (ix) is set where WLED draws it brightest, and the colors lead with the
    // brighter cool shades (turquoise, teal, pink) (measured numbers in HANDOFF.md).
    { fx: 'Colorwaves', pal: 4, sx: 90, ix: 128, col: ['teal', 'pink', 'turquoise'] },
    { fx: 'Plasma', pal: 4, sx: 70, ix: 255, col: ['turquoise', 'pink', 'teal'] }, // ix 255: no dark dips
    { fx: 'Running', pal: 4, sx: 50, ix: 40, col: ['blue', 'teal', 'turquoise'] }, // ocean swells over turquoise (was Pacifica: deep-ocean dark)
    { fx: 'Flow', pal: 4, sx: 80, ix: 128, col: ['pink', 'purple', 'turquoise'] },
    { fx: 'Aurora', pal: 4, sx: 40, ix: 255, col: ['turquoise', 'purple', 'teal'] }, // 20 long-lived waves (ix 255, slower) instead of ~11 sparse ones
    { fx: 'Twinklefox', pal: 4, sx: 100, ix: 255, col: ['pink', 'turquoise', 'purple'] }, // ix 255: every pixel twinkles
  ],
  coolColors: {
    purple: [140, 40, 255, 0], blue: [30, 70, 255, 0], pink: [255, 40, 170, 0],
    teal: [0, 170, 150, 0], turquoise: [0, 230, 210, 0],
  },
  ambientMinutes: 3, // how long each ambient effect runs
  // Ambient layers run at full segment brightness; the host's Dimmer (WLED's master brightness) sets
  // the room level for everything, so nothing in the app ever lowers it on its own.
  ambientBri: 255,
  // Full flashes on the strips' dedicated white chip for exciting moments (never faster than 3/s).
  whiteFlash: { champion: true, leader: true },
  milestoneGold: [255, 170, 0, 0],
  // WLED draws a segment's effect pixel i at physical pixel i + offset (FX_fcn setPixelColor:
  // indexSet += offset). If the bench test shows the curb shifted the wrong way, flip this to false.
  wledOffsetAdds: true,
  // WLED still paints a switched-off segment (black) over the ones below it, so an idle machine zone is
  // "parked" on pixels that don't exist: output 2 is padded to the top run's length, and pixels past
  // the real curb (320+) are invisible. Each idle zone sits on its own pixel from parkStart.
  parkStart: 330,
  scoreAlsoOnTop: true, // machine highlights light the top and curb zones together (one tall column)

  // WLED keeps effect IDs fixed across versions; MQTT can't fetch the list, so they're named here.
  // IDs checked against WLED's FX.h (same in 0.14 and 0.15).
  effects: { Solid: 0, Blink: 1, Breathe: 2, Wipe: 3, Sweep: 6, Running: 15, Colorloop: 8, Rainbow: 9, Fade: 12, Chase: 28, 'Chase Rainbow': 30,
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

// Where an idle machine zone is parked (one invisible pixel each; see parkStart).
export function parkOf(id, cfg = LIGHTS) {
  const { top, curb } = cfg.runs;
  const n = cfg.machineOrder.length;
  const k = id >= curb.firstMachineSeg ? n + (id - curb.firstMachineSeg) : id - top.firstMachineSeg;
  const start = cfg.parkStart + k;
  return { start, stop: start + 1 };
}
