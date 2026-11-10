// Runs on the TV page and drives the garage lights from live party events.
// Only a screen marked as the lights driver sends anything (the TV on the Mac), so /tv opened on a
// phone never doubles a flash. Lights are cosmetic: every call is fire-and-forget, and with the
// lights switched off in /host this sends nothing at all.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LightsEngine } from './engine.js';
import { LIGHTS, hexToRgbw } from './config.js';
import { publish, subscribe, lightsTopic, onLightsTopic } from './mqtt.js';

const DRIVER_KEY = 'pw.lightsDriver';
const HEARTBEAT_MS = 20000;

export function readDriver() {
  try {
    const q = new URLSearchParams(location.search).get('lights');
    if (q === '1' || q === '0') localStorage.setItem(DRIVER_KEY, q);
    return localStorage.getItem(DRIVER_KEY) === '1';
  } catch { return false; }
}

// simOnly (/tv?lights=sim, used by the simulator's TV view): always drives, but only the simulator
// topic, whatever the host settings say. Real strips are never touched.
export function useLightsDirector({ settings, party, scores, players, standings, ready, simOnly = false, simChannel = null }) {
  const [driver, setDriverState] = useState(readDriver);
  const setDriver = useCallback(on => {
    try { localStorage.setItem(DRIVER_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    setDriverState(!!on);
  }, []);

  const enabled = !!settings?.enabled;
  const dry = simOnly || settings?.dry_run !== false;
  // The real controller's channel is a secret this browser learns with the host passcode (unlock
  // /host once on the TV Mac). The simulator's TV view uses its own throwaway channel instead.
  const [hasTopic, setHasTopic] = useState(!!lightsTopic());
  useEffect(() => onLightsTopic(() => setHasTopic(true)), []);
  const active = simOnly ? ready : driver && enabled && ready && hasTopic;
  const engineRef = useRef(null);
  const colorOf = useRef(() => [255, 0, 170, 0]);
  colorOf.current = pid => hexToRgbw(players.find(p => p.id === pid)?.color);

  const partyRef = useRef(party);
  partyRef.current = party;

  // Create / tear down the engine when this screen starts or stops driving.
  useEffect(() => {
    if (!active) return undefined;
    const sendTo = simChannel || (dry ? 'sim' : 'api');
    const engine = new LightsEngine({ send: payload => publish(sendTo, payload), zones: settings?.zones || undefined, music: settings?.music || null });
    engineRef.current = engine;
    // During the party: clean slate, zones pushed, party lights on. Outside it (not open), the room
    // belongs to your WLED preset and the TV only adds moments.
    if (simOnly || partyRef.current?.status === 'open') engine.start(); else engine.stop();
    const beat = () => { if (!simOnly) publish('director', { at: Date.now(), dry, page: 'tv' }, { retain: true }); };
    beat();
    const iv = setInterval(beat, HEARTBEAT_MS);
    // WLED re-publishes "online" after every change, so only "online" after "offline" means it
    // rebooted and lost our segments: then push them again. (A minute-by-minute re-push covers
    // reboots too quick to announce "offline".)
    let last = null;
    const unStatus = simOnly ? () => {} : subscribe('status', m => {
      const now = String(m).toLowerCase().includes('online') ? 'online' : 'offline';
      if (last === 'offline' && now === 'online') engine.resync();
      last = now;
    });
    const bye = () => { engine.stop(); if (!simOnly) publish('director', { at: Date.now(), off: true }, { retain: true }); };
    window.addEventListener('pagehide', bye);
    // Safari can restore this page from its back/forward cache after pagehide: pick the party back up.
    const back = ev => { if (ev.persisted && (simOnly || partyRef.current?.status === 'open')) engine.start(); };
    window.addEventListener('pageshow', back);
    return () => {
      clearInterval(iv);
      unStatus();
      window.removeEventListener('pagehide', bye);
      window.removeEventListener('pageshow', back);
      bye();
      engine.destroy();
      engineRef.current = null;
    };
  }, [active, dry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saved zones changed (calibration): push the new bounds.
  const zonesKey = JSON.stringify(settings?.zones || null);
  useEffect(() => {
    const e = engineRef.current;
    if (e && settings?.zones) { e.applyLayout(settings.zones); e.flush(); }
  }, [zonesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Music mode switched on/off in /host.
  const music = settings?.music || null;
  useEffect(() => { engineRef.current?.setMusic(music); }, [music]);

  // Party opened / closed, and the end of the reveal.
  const statusRef = useRef(null);
  const revealRef = useRef(null);
  useEffect(() => {
    const e = engineRef.current;
    const status = party?.status ?? null;
    if (statusRef.current && status !== statusRef.current && e) {
      if (status === 'open') e.partyOpen();
      else if (status === 'closed' && !party?.reveal_active) e.stop();
    }
    statusRef.current = status;
    const rev = !!party?.reveal_active;
    if (revealRef.current && !rev && e) {
      if (status === 'open') e.revealEnd(); else e.stop(); // party closed: straight back to your preset
    }
    revealRef.current = rev;
  }, [party?.status, party?.reveal_active]);

  // Host commands (house lights, tests, brightness…) and simulator event buttons.
  useEffect(() => {
    if (!active) return undefined;
    return subscribe('control', msg => {
      const e = engineRef.current;
      if (window.__lightsDebug) console.log('[lights] control', JSON.stringify(msg), !!e, Date.now() - (msg?.at || 0));
      if (!e || !msg || typeof msg !== 'object' || Date.now() - (msg.at || 0) > 15000) return;
      runControl(e, msg);
    });
  }, [active]);

  // The reveal calls this for each count of the 3-2-1 (phase 'count', n = 3, 2, 1) and when the
  // winner appears (phase 'show'), so the strips and the TV share one timeline.
  const onRevealSlide = useCallback((slide, phase = 'show', n = 0) => {
    const e = engineRef.current;
    if (!e) return;
    const hex = slide.hero?.color || slide.list?.[0]?.player?.color || slide.accent;
    if (phase === 'count') e.revealTick(n, hexToRgbw(slide.accent || hex));
    else e.revealCue({ color: hexToRgbw(hex), machineId: slide.machine?.id, final: slide.label === 'GRAND CHAMPION' });
  }, []);

  // The lights follow what the TV puts on screen, at the moment it appears (live and demo alike):
  //   a score hits a cabinet → that machine breathes (player color ↔ machine color)
  //   machine record takeover → champion: white flashes, then the machine's colors chase out
  //   new #1 takeover → leader: white bounces top ↔ curb, then the room washes in their color
  //   ranked takeover (a player unlocks their ranking) → the room breathes once in their color
  //   games milestone takeover → gold top ↔ curb bounce
  //   Wall of Shame note → the room sags to a slow dim red
  //   attract spotlights and small notes (joins, PBs, climbs) → nothing: the cabinet pulse covers them
  const onHit = useCallback(hit => {
    const e = engineRef.current;
    if (e && hit?.machine) e.score(hit.machine.id, colorOf.current(hit.player?.id));
  }, []);
  const onTakeover = useCallback(tk => {
    const e = engineRef.current;
    if (!e || !tk) return;
    const c = colorOf.current(tk.player?.id);
    if (tk.kind === 'record' && tk.machine) e.champion(tk.machine.id, c);
    else if (tk.kind === 'leader') e.leader(c);
    else if (tk.kind === 'ranked') e.ranked(c);
    else if (tk.kind === 'milestone') e.milestone();
  }, []);
  const onToast = useCallback(t => {
    const e = engineRef.current;
    if (e && t?.kind === 'shame') e.shame();
  }, []);

  return { driver, setDriver, enabled, dry, active, hasTopic, onRevealSlide, onHit, onTakeover, onToast };
}

// Shared by the TV (as driver) and the simulator / host page (when no TV is driving).
export function runControl(e, msg) {
  const color = Array.isArray(msg.color) ? msg.color : hexToRgbw(msg.color);
  switch (msg.cmd) {
    case 'house': e.setHouse(!!msg.on); break;
    case 'ambient': e.ambient(); break;
    case 'bri': e.brightness(msg.value); break;
    case 'test': e.test(msg.machineId, color); break;
    case 'score': e.score(msg.machineId, color); break;
    case 'champion': e.champion(msg.machineId, color); break;
    case 'leader': e.leader(color); break;
    case 'pingpong': e.pingPong(color); break;
    case 'ranked': e.ranked(color); break;
    case 'milestone': e.milestone(); break;
    case 'shame': e.shame(); break;
    case 'open': e.partyOpen(); break;
    case 'close': e.stop(); break;
    case 'reveal': e.revealCue({ color, machineId: msg.machineId, final: !!msg.final }); break;
    case 'revealTick': e.revealTick(msg.n, color); break;
    case 'revealEnd': e.revealEnd(); break;
    case 'layout': e.applyLayout(msg.zones || e.zones); e.flush(); break;
    case 'music': e.setMusic(msg.name || null); break;
    default: break;
  }
}

export { LIGHTS };
