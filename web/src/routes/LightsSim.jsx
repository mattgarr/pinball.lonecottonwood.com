// /lights-sim: shows, live, what the garage strips are doing. It listens to every command the TV
// sends (to the real controller, or to the simulator in dry-run mode) and has its own event buttons.
// "Simulator only" plays effects here and sends nothing; "Send to hardware" plays them on the strips too.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useParty } from '../lib/store.js';
import { LIGHTS, defaultZones } from '../lib/lights/config.js';
import { LightsEngine } from '../lib/lights/engine.js';
import { runControl } from '../lib/lights/useLightsDirector.js';
import { publish, subscribe, onConnection } from '../lib/lights/mqtt.js';
import { applyMessage, newModel, renderRange } from '../lib/lights/render.js';

// The 12 player colors (same palette players get when they sign up).
const COLORS = ['#ff5b6e', '#ffb020', '#ffd84d', '#38d39f', '#2ec5e8', '#5b8cff', '#a07bff', '#ff6fd0', '#7ee081', '#ff8a4c', '#4dd4c4', '#c9a0ff'];

export default function LightsSim() {
  const { allMachines, lights: settings } = useParty();
  const zones = settings?.zones || defaultZones();
  const [hardware, setHardware] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [machineId, setMachineId] = useState(LIGHTS.machineOrder[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [house, setHouse] = useState(false);
  const [conn, setConn] = useState(false);
  const [log, setLog] = useState([]);
  const model = useRef(newModel());
  const canvasTop = useRef(null), canvasCurb = useRef(null);
  const nameOf = id => allMachines.find(m => m.id === id)?.name || `#${id}`;
  const shortName = id => { const n = nameOf(id); return /dragons/i.test(n) ? 'D&D' : n.split(' ')[0]; };
  // Pixel size: fit the whole top run across the screen (both runs use the same size, to scale).
  const fit = () => Math.max(3, Math.min(10, Math.floor((window.innerWidth - 40) / (LIGHTS.runs.top.stop - LIGHTS.runs.top.start))));
  const [PX, setPX] = useState(fit);
  useEffect(() => { const r = () => setPX(fit()); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Seed the model with the current layout so zones and base segments render before any traffic.
  useEffect(() => {
    const seed = new LightsEngine({ send: msg => applyMessage(model.current, msg), zones });
    seed.applyLayout(zones); seed.flush(); seed.destroy();
  }, [JSON.stringify(zones)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live traffic from the TV (real or dry-run).
  useEffect(() => {
    const show = (src) => msg => {
      applyMessage(model.current, msg);
      setLog(l => [{ at: new Date().toLocaleTimeString(), src, msg: JSON.stringify(msg).slice(0, 160) }, ...l].slice(0, 12));
    };
    const a = subscribe('api', show('hardware')), b = subscribe('sim', show('simulator'));
    const c = onConnection(setConn);
    return () => { a(); b(); c(); };
  }, []);

  // This page's own engine for the event buttons.
  const engine = useMemo(() => new LightsEngine({
    zones, timeScale: speed,
    send: msg => {
      if (hardware) { publish('api', msg); return; } // comes back through the live subscription
      applyMessage(model.current, msg);
      setLog(l => [{ at: new Date().toLocaleTimeString(), src: 'this page', msg: JSON.stringify(msg).slice(0, 160) }, ...l].slice(0, 12));
    },
  }), [hardware, speed, JSON.stringify(zones)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => engine.destroy(), [engine]);

  // Draw both strips at the same pixel size, so the top run shows about 2.75× as long as the curb.
  useEffect(() => {
    let raf;
    const draw = () => {
      const now = performance.now();
      for (const [ref, run] of [[canvasTop, LIGHTS.runs.top], [canvasCurb, LIGHTS.runs.curb]]) {
        const cv = ref.current; if (!cv) continue;
        const ctx = cv.getContext('2d');
        const px = renderRange(model.current, run.start, run.stop, now, speed);
        ctx.fillStyle = '#05050a'; ctx.fillRect(0, 0, cv.width, cv.height);
        px.forEach(([r, g, b], i) => {
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.shadowColor = `rgb(${r},${g},${b})`; ctx.shadowBlur = 8;
          ctx.fillRect(i * PX, 6, Math.max(2, PX - 1), cv.height - 12);
        });
        ctx.shadowBlur = 0;
      }
    };
    // A plain timer (not requestAnimationFrame) keeps drawing even when the window is in the background.
    raf = setInterval(draw, 33);
    draw();
    return () => clearInterval(raf);
  }, [speed, PX]);

  const fire = (cmd, extra = {}) => runControl(engine, { cmd, machineId, color, at: Date.now(), ...extra });

  async function revealDemo() {
    const order = LIGHTS.machineOrder;
    const cues = [
      ...order.map((m, i) => ({ color: COLORS[i * 2 % COLORS.length], machineId: m })),
      { color: COLORS[4] }, { color: COLORS[6] }, { color, final: true },
    ];
    for (const c of cues) {
      fire('reveal', c);
      await new Promise(r => setTimeout(r, (c.final ? 7000 : 2500) * speed));
    }
    fire('revealEnd');
  }

  const W = (run) => (run.stop - run.start) * PX;
  const zoneLabels = (list, run) => list.map((z, i) => (
    <div key={z.machineId} className="ls-zone" title={nameOf(z.machineId)} style={{ left: (z.start - run.start) * PX, width: (z.stop - z.start) * PX, background: i % 2 ? '#1c1c2e' : '#26263c' }}>
      {shortName(z.machineId)}
    </div>
  ));
  let acc = 0;

  return (
    <div className="ls-page">
      <div className="ls-head">
        <h1>Garage lights simulator</h1>
        <span className={`ls-dot ${conn ? 'ok' : 'bad'}`} /> {conn ? 'Connected' : 'Connecting…'}
        <Link to="/host" className="ls-back">← Host</Link>
      </div>

      <div className="ls-strip">
        <div className="ls-label">Top run ({LIGHTS.runs.top.stop - LIGHTS.runs.top.start} px)</div>
        <div className="ls-scroll">
          <div style={{ position: 'relative', width: W(LIGHTS.runs.top) }}>
            <div className="ls-sections">
              {LIGHTS.runs.top.sections.map(s => { const l = acc; acc += s.len; return <div key={s.name} className="ls-section" style={{ left: l * PX, width: s.len * PX }}>{s.name}</div>; })}
            </div>
            <canvas ref={canvasTop} width={W(LIGHTS.runs.top)} height={40} />
            <div className="ls-zones">{zoneLabels(zones.top, LIGHTS.runs.top)}</div>
          </div>
        </div>
      </div>

      <div className="ls-strip">
        <div className="ls-label">Curb run, behind the machines ({LIGHTS.runs.curb.stop - LIGHTS.runs.curb.start} px)</div>
        <div className="ls-scroll">
          <div style={{ position: 'relative', width: W(LIGHTS.runs.curb) }}>
            <canvas ref={canvasCurb} width={W(LIGHTS.runs.curb)} height={40} />
            <div className="ls-zones">{zoneLabels(zones.curb, LIGHTS.runs.curb)}</div>
          </div>
        </div>
      </div>

      <div className="ls-controls">
        <div className="ls-row">
          <label className="ls-mode"><input type="radio" checked={!hardware} onChange={() => setHardware(false)} /> Simulator only</label>
          <label className="ls-mode"><input type="radio" checked={hardware} onChange={() => setHardware(true)} /> Send to hardware</label>
          <label>Speed
            <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
              <option value={1}>Normal</option><option value={2}>½ speed</option><option value={4}>¼ speed</option>
            </select>
          </label>
        </div>
        <div className="ls-row">
          <label>Machine
            <select value={machineId} onChange={e => setMachineId(Number(e.target.value))}>
              {LIGHTS.machineOrder.map(id => <option key={id} value={id}>{nameOf(id)}</option>)}
            </select>
          </label>
          <div className="ls-colors">
            {COLORS.map(c => <button key={c} type="button" className={`ls-color${c === color ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}
          </div>
        </div>
        <div className="ls-row ls-buttons">
          <button type="button" onClick={() => fire('score')}>Score</button>
          <button type="button" onClick={() => fire('champion')}>Machine champion</button>
          <button type="button" onClick={() => fire('leader')}>New leader</button>
          <button type="button" onClick={() => fire('open')}>Party open</button>
          <button type="button" onClick={() => fire('close')}>Party close</button>
          <button type="button" onClick={revealDemo}>Winner reveal</button>
          <button type="button" onClick={() => { fire('house', { on: !house }); setHouse(!house); }}>{house ? 'House lights off' : 'House lights'}</button>
        </div>
      </div>

      <div className="ls-log">
        <div className="ls-label">Live commands (from the TV and this page)</div>
        {log.length ? log.map((l, i) => <div key={i}><b>{l.at}</b> [{l.src}] {l.msg}</div>) : <div className="ls-dim">Nothing yet. Commands the TV sends show up here.</div>}
      </div>
    </div>
  );
}
