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
  runs: {
    top: { start: 0, stop: 235, baseSeg: 0, firstMachineSeg: 1,
      sections: [{ name: 'Left wall', len: 43 }, { name: 'Loft beam', len: 149 }, { name: 'Right wall', len: 43 }] },
    curb: { start: 235, stop: 320, baseSeg: 7, firstMachineSeg: 8 },
  },
  pointerSeg: 14, // temporary one-pixel pointer used by the calibration page

  // The state the two base segments return to after an effect (and on party open).
  partyBase: { fx: 'Colorloop', sx: 60, ix: 128, bri: 170, col: [[157, 77, 255, 0], [0, 229, 255, 0], [255, 0, 170, 0]] },
  scoreAlsoOnTop: false, // score pulses light only the curb zone behind the machine

  // WLED keeps effect IDs fixed across versions; MQTT can't fetch the list, so they're named here.
  effects: { Solid: 0, Blink: 1, Breathe: 2, Wipe: 3, Sweep: 6, Colorloop: 8, Rainbow: 9, Fade: 12, Chase: 28, 'Chase Rainbow': 30 },

  houseWhite: [0, 0, 0, 255], // the strip's dedicated white chip
  ambientPreset: 1, // Matt's Arcade Attract playlist; the app never writes presets
};

// Default machine zones: split each run evenly (the top run's zones sit on the loft beam).
export function defaultZones(cfg = LIGHTS) {
  const n = cfg.machineOrder.length;
  const split = (a, b) => cfg.machineOrder.map((id, i) => ({
    machineId: id,
    start: Math.round(a + ((b - a) * i) / n),
    stop: Math.round(a + ((b - a) * (i + 1)) / n),
  }));
  const [left, beam] = cfg.runs.top.sections;
  const beamStart = cfg.runs.top.start + left.len;
  return {
    top: split(beamStart, beamStart + beam.len),
    curb: split(cfg.runs.curb.start, cfg.runs.curb.stop),
  };
}

// '#ff5b6e' → [255, 91, 110, 0] (W stays 0: white is reserved for house lights).
export function hexToRgbw(hex) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return [255, 0, 170, 0];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 0];
}
