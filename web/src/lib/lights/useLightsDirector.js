// Runs on the TV page and drives the garage lights from live party events.
// Only a screen marked as the lights driver sends anything (the TV on the Mac), so /tv opened on a
// phone never doubles a flash. Lights are cosmetic: every call is fire-and-forget, and with the
// lights switched off in /host this sends nothing at all.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LightsEngine } from './engine.js';
import { LIGHTS, hexToRgbw } from './config.js';
import { publish, subscribe } from './mqtt.js';

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
export function useLightsDirector({ settings, party, scores, players, standings, ready, simOnly = false }) {
  const [driver, setDriverState] = useState(readDriver);
  const setDriver = useCallback(on => {
    try { localStorage.setItem(DRIVER_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    setDriverState(!!on);
  }, []);

  const enabled = !!settings?.enabled;
  const dry = simOnly || settings?.dry_run !== false;
  const active = simOnly ? ready : driver && enabled && ready;
  const engineRef = useRef(null);
  const colorOf = useRef(() => [255, 0, 170, 0]);
  colorOf.current = pid => hexToRgbw(players.find(p => p.id === pid)?.color);

  // Create / tear down the engine when this screen starts or stops driving.
  useEffect(() => {
    if (!active) return undefined;
    const sendTo = dry ? 'sim' : 'api';
    const engine = new LightsEngine({ send: payload => publish(sendTo, payload), zones: settings?.zones || undefined, music: settings?.music || null });
    engineRef.current = engine;
    engine.start(); // clean slate: zones pushed, machine segments off, party base on
    const beat = () => { if (!simOnly) publish('director', { at: Date.now(), dry, page: 'tv' }, { retain: true }); };
    beat();
    const iv = setInterval(beat, HEARTBEAT_MS);
    const bye = () => { engine.stop(); if (!simOnly) publish('director', { at: Date.now(), off: true }, { retain: true }); };
    window.addEventListener('pagehide', bye);
    return () => {
      clearInterval(iv);
      window.removeEventListener('pagehide', bye);
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

  // New scores: a pulse behind that machine, or a champion effect when it's a new high score.
  const seen = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const live = scores.filter(s => !s.voided);
    if (!seen.current) { seen.current = new Set(scores.map(s => s.id)); return; }
    const fresh = live.filter(s => !seen.current.has(s.id));
    for (const s of scores) seen.current.add(s.id);
    const e = engineRef.current;
    if (!e || !fresh.length) return;
    for (const s of fresh) {
      const before = live.filter(x => x.machine_id === s.machine_id && x.id !== s.id && !fresh.includes(x));
      const best = before.reduce((m, x) => Math.max(m, x.value), -1);
      if (best >= 0 && s.value > best) e.champion(s.machine_id, colorOf.current(s.player_id));
      else e.score(s.machine_id, colorOf.current(s.player_id));
    }
  }, [scores, ready]);

  // A new overall leader (#1 rating changes hands).
  const leaderRef = useRef(undefined);
  const leaderId = standings?.ranked?.[0]?.player?.id ?? null;
  useEffect(() => {
    if (!ready) return;
    if (leaderRef.current === undefined) { leaderRef.current = leaderId; return; }
    if (leaderId && leaderId !== leaderRef.current) engineRef.current?.leader(colorOf.current(leaderId));
    leaderRef.current = leaderId;
  }, [leaderId, ready]);

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
    if (revealRef.current && !rev && e) e.revealEnd();
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

  // The reveal calls this as each slide appears.
  const onRevealSlide = useCallback(slide => {
    const e = engineRef.current;
    if (!e) return;
    const hex = slide.hero?.color || slide.list?.[0]?.player?.color || slide.accent;
    e.revealCue({ color: hexToRgbw(hex), machineId: slide.machine?.id, final: slide.label === 'GRAND CHAMPION' });
  }, []);

  // Demo events from the TV's demo mode (simulator preview only).
  const onDemo = useCallback(ev => {
    const e = engineRef.current;
    if (!e || !simOnly) return;
    const c = colorOf.current(ev.player?.id);
    if (ev.kind === 'score') e.score(ev.machineId, c);
    else if (ev.kind === 'champion') e.champion(ev.machineId, c);
    else if (ev.kind === 'leader') e.leader(c);
  }, [simOnly]);

  return { driver, setDriver, enabled, dry, active, onRevealSlide, onDemo };
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
    case 'open': e.partyOpen(); break;
    case 'close': e.stop(); break;
    case 'reveal': e.revealCue({ color, machineId: msg.machineId, final: !!msg.final }); break;
    case 'revealEnd': e.revealEnd(); break;
    case 'layout': e.applyLayout(msg.zones || e.zones); e.flush(); break;
    case 'music': e.setMusic(msg.name || null); break;
    default: break;
  }
}

export { LIGHTS };
