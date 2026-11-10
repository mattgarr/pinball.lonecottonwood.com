// Host: the garage lights card. Shows whether the lights and the TV that drives them are online,
// turns the lights on/off for the party, and has the manual buttons (the master dimmer, ambient,
// house lights, a test flash per machine). Commands go to the TV that drives the lights; if no TV is
// driving, this page sends them itself.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ensureLightsTopic, host, useParty } from '../lib/store.js';
import { LIGHTS, defaultZones } from '../lib/lights/config.js';
import { buildPresets } from '../lib/lights/presets.js';
import { LightsEngine } from '../lib/lights/engine.js';
import { runControl } from '../lib/lights/useLightsDirector.js';
import { publish, subscribe, onConnection, lightsTopic, onLightsTopic } from '../lib/lights/mqtt.js';
import { DIMMER_DEFAULT, ECHO_MS, cachedDimmer, dimmerPct, saveDimmer, watchDimmer } from '../lib/lights/dimmer.js';

const COLORS = ['#ff5b6e', '#ffb020', '#ffd84d', '#38d39f', '#2ec5e8', '#5b8cff', '#a07bff', '#ff6fd0', '#7ee081', '#ff8a4c', '#4dd4c4', '#c9a0ff'];
const DRIVER_FRESH_MS = 60000;
const DIMMER_STEPS = [25, 50, 75, 100]; // % quick picks

export default function LightsPanel({ busy, run }) {
  const { lights: settings, allMachines } = useParty();
  const [wled, setWled] = useState(null); // 'online' | 'offline' | null (never heard)
  const [driver, setDriver] = useState(null); // last heartbeat from the TV
  const [conn, setConn] = useState(false);
  const [house, setHouse] = useState(false);
  const [dim, setDim] = useState(() => cachedDimmer() ?? DIMMER_DEFAULT); // master dimmer, 1–255
  const dimTouched = useRef(0);
  const [testColor, setTestColor] = useState(COLORS[0]);
  const [now, setNow] = useState(Date.now());
  const dimTimer = useRef(null);

  const [topic, setTopic] = useState(lightsTopic());
  useEffect(() => { ensureLightsTopic().then(t => setTopic(t)); return onLightsTopic(setTopic); }, []);
  useEffect(() => {
    const a = subscribe('status', m => setWled(String(m).toLowerCase().includes('online') ? 'online' : 'offline'));
    const b = subscribe('director', m => setDriver(m && typeof m === 'object' ? m : null));
    const c = onConnection(setConn);
    const iv = setInterval(() => setNow(Date.now()), 15000);
    return () => { a(); b(); c(); clearInterval(iv); };
  }, []);

  const enabled = !!settings?.enabled;
  const dry = settings?.dry_run !== false;
  const tvDriving = driver && !driver.off && now - (driver.at || 0) < DRIVER_FRESH_MS;

  // Fallback engine for when no TV is driving the lights.
  const local = useMemo(() => new LightsEngine({ zones: settings?.zones || undefined, send: msg => publish(dry ? 'sim' : 'api', msg) }), [dry, JSON.stringify(settings?.zones || null)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => local.destroy(), [local]);

  const command = msg => {
    const full = { ...msg, at: Date.now() };
    if (tvDriving) publish('control', full);
    else runControl(local, full);
  };

  // The dimmer shows the level everyone shares (retained on the broker) and what the controller
  // reports (the remote's brightness buttons), except right after this page moved it.
  useEffect(() => watchDimmer((v, src) => {
    if (Date.now() - dimTouched.current < ECHO_MS) return;
    if (src === 'wled' && dry) return; // simulator only: the real controller's level isn't the one in use
    setDim(v);
  }), [dry]);
  const changeDimmer = (v, now = false) => {
    setDim(v); dimTouched.current = Date.now();
    const go = () => { dimTouched.current = Date.now(); saveDimmer(v); command({ cmd: 'bri', value: v }); };
    clearTimeout(dimTimer.current);
    if (now) go(); else dimTimer.current = setTimeout(go, 150);
  };
  useEffect(() => () => clearTimeout(dimTimer.current), []);

  if (!settings) {
    return (
      <section className="card">
        <h2>Garage lights</h2>
        <p className="muted small">Not set up yet: run database step 0018 (lights) in Supabase.</p>
      </section>
    );
  }

  const dot = (ok, label) => <span className="lights-stat"><span className={`ls-dot ${ok === null ? 'idle' : ok ? 'ok' : 'bad'}`} />{label}</span>;

  return (
    <section id="sec-lights" className="card lights-card">
      <div className="host-card-head">
        <h2>Garage lights</h2>
        <a className="ghost" href="/lights-sim" target="_blank" rel="noreferrer">Open simulator ↗</a>
      </div>
      <div className="lights-status">
        {dot(wled === null ? null : wled === 'online', wled === 'online' ? 'Lights online' : wled === 'offline' ? 'Lights offline' : 'Lights: not heard from yet')}
        {dot(tvDriving ? true : (driver ? false : null), tvDriving ? `TV driving${driver.dry ? ' (simulator only)' : ''}` : 'No TV driving the lights')}
        {!conn && <span className="muted small">Connecting…</span>}
      </div>
      <p className="muted small">
        Lights are extra: the party works the same with them off or unplugged.
        {' '}{enabled ? (dry ? 'They\'re ON in simulator-only mode: effects show on the simulator, not the strips.' : 'They\'re ON: the TV flashes the strips on every score.') : 'They\'re OFF: the TV sends nothing to the lights.'}
      </p>
      <div className="row gap lights-row">
        <button type="button" className={enabled ? 'secondary' : 'primary'} disabled={busy}
          onClick={() => run(() => host.setLights({ enabled: !enabled }), enabled ? 'Lights effects OFF.' : 'Lights effects ON.')}>
          {enabled ? 'Turn light effects off' : 'Turn light effects on'}
        </button>
        <button type="button" className="secondary" disabled={busy}
          onClick={() => run(() => host.setLights({ dryRun: !dry }), dry ? 'Now sending to the real strips.' : 'Simulator only.')}>
          {dry ? 'Use the real strips' : 'Simulator only'}
        </button>
      </div>
      <div className="lights-dimmer">
        <label className="lights-dimmer-head" htmlFor="lights-dimmer">
          <span>Dimmer</span>
          <span className="lights-dimmer-val">{dimmerPct(dim)}%</span>
        </label>
        <input id="lights-dimmer" type="range" min={13} max={255} value={dim}
          aria-valuetext={`${dimmerPct(dim)}%`} onChange={e => changeDimmer(Number(e.target.value))} />
        <div className="lights-dimmer-steps">
          {DIMMER_STEPS.map(p => {
            const v = Math.round((p / 100) * 255);
            return <button key={p} type="button" className={`ghost${dimmerPct(dim) === p ? ' on' : ''}`} onClick={() => changeDimmer(v, true)}>{p}%</button>;
          })}
        </div>
        <p className="muted small">The whole garage's brightness: every look, score flash and the remote's shows. Remembered after a TV reload or a controller restart.{tvDriving ? '' : dry ? ' Simulator only: the real strips aren\'t changed.' : ' No TV open: this page sets the lights directly.'}</p>
      </div>
      <div className="row gap lights-row">
        <button type="button" className="secondary" onClick={() => { command({ cmd: 'ambient' }); setHouse(false); }}>Back to attract loop</button>
        <button type="button" className={house ? 'primary' : 'secondary'} onClick={() => { command({ cmd: 'house', on: !house }); setHouse(!house); }}>
          {house ? 'House lights: ON (tap to end)' : 'House lights'}
        </button>
      </div>
      <label className="lights-bri">Music mode
        <select value={settings.music || ''} disabled={busy}
          onChange={e => { const v = e.target.value; run(() => host.setLights({ music: v }), v ? `Music mode: ${LIGHTS.music[v].label}.` : 'Music mode off: ambient effects rotate.'); }}>
          <option value="">Off (ambient effects rotate)</option>
          {Object.entries(LIGHTS.music).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
      </label>
      <p className="muted small">Music mode uses the controller's microphone. Score and champion flashes still play on top.</p>
      <div className="lights-test">
        <div className="muted small">Test a machine's flash:</div>
        <div className="ls-colors">
          {COLORS.map(c => <button key={c} type="button" className={`ls-color${c === testColor ? ' on' : ''}`} style={{ background: c }} onClick={() => setTestColor(c)} aria-label={c} />)}
        </div>
        <div className="lights-machines">
          {LIGHTS.machineOrder.map(id => (
            <button key={id} type="button" className="secondary" onClick={() => command({ cmd: 'test', machineId: id, color: testColor })}>
              {allMachines.find(m => m.id === id)?.name || `#${id}`}
            </button>
          ))}
        </div>
      </div>
      <div className="row gap lights-row">
        <Link className="ghost" to="/host/calibrate">Calibrate machine zones</Link>
      </div>
      <div className="row gap lights-row">
        <button type="button" className="ghost" onClick={() => downloadPresets(settings.zones)}>Download controller presets</button>
      </div>
      <p className="muted small">The lights' own shows for when the TV isn't running (Attract, Calm, Exciting, Music, Machine showcase, House lights, Cozy, Off). Upload the file in WLED: Config → Security &amp; Updates → Restore presets. Download it again after calibrating.</p>
      <p className="muted small">The TV drives the lights once you unlock this host page on the TV's Mac, move the mouse to the bottom-right corner of the TV and click "Lights: click to drive the garage lights from this screen".</p>
      <div className="lights-topic">
        <div className="muted small">For WLED's MQTT settings (keep these private: anyone with them can control the lights):</div>
        <div className="small">Device Topic: <code>{topic || 'loading…'}</code></div>
        <div className="small">Group Topic: <code>{topic ? `${topic}g` : 'loading…'}</code></div>
      </div>
    </section>
  );
}

function downloadPresets(zones) {
  const blob = new Blob([JSON.stringify(buildPresets(zones || defaultZones()))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'presets.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
