// /host/calibrate: line up each machine's light zone with the real machine.
// Put painter's tape on the wall at the halfway point between each pair of machines, plus the outer
// edge of the first and last machine (7 marks per run). Here, a single white pixel lights up on the
// real strip: move it onto each tape mark and tap Mark. After 7 marks the six zones light up in turn
// to check, then Save stores them and pushes them to the controller.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getHostPass, host, useParty } from '../lib/store.js';
import { LIGHTS, defaultZones } from '../lib/lights/config.js';
import { publish } from '../lib/lights/mqtt.js';

const P = LIGHTS.pointerSeg;
const MARKS = LIGHTS.machineOrder.length + 1;
const ALT = [[255, 0, 170, 0], [0, 229, 255, 0]];

export default function HostCalibrate() {
  const { lights: settings, allMachines } = useParty();
  const [runKey, setRunKey] = useState('top');
  const run = LIGHTS.runs[runKey];
  const [pos, setPos] = useState(run.start);
  const [marks, setMarks] = useState([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const nameOf = id => allMachines.find(m => m.id === id)?.name || `#${id}`;
  const firstSeg = run.firstMachineSeg;
  const timers = useRef([]);

  // Commands go to the real controller (and the simulator, so it shows there too).
  const send = body => { publish('api', body); publish('sim', body); };
  const pointer = n => send({ on: true, seg: [{ id: P, start: n, stop: n + 1, on: true, fx: 0, bri: 255, col: [[255, 255, 255, 255]] }] });
  const removePointer = () => send({ seg: [{ id: P, stop: 0 }] });

  useEffect(() => { pointer(pos); }, [pos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { timers.current.forEach(clearTimeout); removePointer(); }, []); // leaving the page removes the pointer

  function pickRun(k) {
    setRunKey(k); setMarks([]); setMsg('');
    const r = LIGHTS.runs[k];
    setPos(marksStart(k, r));
  }
  function marksStart(k, r) {
    const z = settings?.zones?.[k]?.[0];
    return z ? z.start : r.start;
  }
  const move = d => setPos(p => Math.max(run.start, Math.min(run.stop - 1, p + d)));

  function mark() {
    if (marks.length >= MARKS) return;
    if (marks.length && pos <= marks[marks.length - 1]) { setMsg('Each mark must be further along the strip than the last one.'); return; }
    const next = [...marks, pos];
    setMarks(next); setMsg('');
    if (next.length === MARKS) verify(next);
  }

  const zonesFrom = m => LIGHTS.machineOrder.map((id, i) => ({ machineId: id, start: m[i], stop: m[i + 1] }));

  // Light each zone in turn in alternating colors, then all together.
  function verify(m) {
    timers.current.forEach(clearTimeout); timers.current = [];
    const zones = zonesFrom(m);
    send({ seg: zones.map((z, i) => ({ id: firstSeg + i, start: z.start, stop: z.stop, on: false })) });
    zones.forEach((z, i) => {
      timers.current.push(setTimeout(() => send({ seg: [{ id: firstSeg + i, on: true, fx: 0, bri: 255, col: [ALT[i % 2]] }] }), 400 + i * 900));
    });
    timers.current.push(setTimeout(() => send({ seg: zones.map((z, i) => ({ id: firstSeg + i, on: false })) }), 400 + zones.length * 900 + 2500));
  }

  async function save() {
    setBusy(true);
    try {
      const base = settings?.zones || defaultZones();
      const zones = { ...base, [runKey]: zonesFrom(marks) };
      await host.setLights({ zones });
      publish('control', { cmd: 'layout', zones, at: Date.now() }); // the TV pushes the new bounds
      setMsg(`Saved the ${runKey === 'top' ? 'top run' : 'curb run'} zones.`);
    } catch (e) { setMsg(`⚠ ${e.message}`); }
    finally { setBusy(false); }
  }

  if (!getHostPass()) return <div className="screen"><p>Unlock the host page first.</p><Link to="/host">← Host</Link></div>;

  const nextLabel = marks.length < MARKS
    ? (marks.length === 0 ? `the outer edge of ${nameOf(LIGHTS.machineOrder[0])}`
      : marks.length === MARKS - 1 ? `the outer edge of ${nameOf(LIGHTS.machineOrder.at(-1))}`
        : `halfway between ${nameOf(LIGHTS.machineOrder[marks.length - 1])} and ${nameOf(LIGHTS.machineOrder[marks.length])}`)
    : null;

  return (
    <div className="screen calib">
      <Link className="back" to="/host">← Host</Link>
      <h1>Calibrate light zones</h1>
      <p className="muted small">Tape the wall first: one mark at the outer edge of the first and last machine, and one halfway between each pair (7 marks per run). Then walk the white dot to each mark.</p>

      <div className="row gap">
        <button type="button" className={runKey === 'top' ? 'primary' : 'secondary'} onClick={() => pickRun('top')}>Top run (loft beam)</button>
        <button type="button" className={runKey === 'curb' ? 'primary' : 'secondary'} onClick={() => pickRun('curb')}>Curb run</button>
      </div>

      <div className="calib-pos">Dot at pixel <b>{pos}</b></div>
      <div className="row gap calib-arrows">
        <button type="button" className="secondary" onClick={() => move(-10)}>◀◀ 10</button>
        <button type="button" className="secondary" onClick={() => move(-1)}>◀ 1</button>
        <button type="button" className="secondary" onClick={() => move(1)}>1 ▶</button>
        <button type="button" className="secondary" onClick={() => move(10)}>10 ▶▶</button>
      </div>

      {nextLabel && <p>Next mark ({marks.length + 1} of {MARKS}): <b>{nextLabel}</b></p>}
      <div className="row gap">
        <button type="button" className="primary" disabled={marks.length >= MARKS} onClick={mark}>Mark</button>
        <button type="button" className="secondary" disabled={!marks.length} onClick={() => { setMarks(marks.slice(0, -1)); setMsg(''); }}>Undo last mark</button>
      </div>

      {marks.length > 0 && <p className="muted small">Marks: {marks.join(', ')}</p>}

      {marks.length === MARKS && (
        <div className="card">
          <h2>Zones</h2>
          <ul className="calib-zones">
            {zonesFrom(marks).map(z => <li key={z.machineId}>{nameOf(z.machineId)}: pixels {z.start}–{z.stop - 1}</li>)}
          </ul>
          <div className="row gap">
            <button type="button" className="secondary" onClick={() => verify(marks)}>Light them again</button>
            <button type="button" className="primary" disabled={busy} onClick={save}>Save these zones</button>
          </div>
        </div>
      )}
      {msg && <p className={msg.startsWith('⚠') ? 'err' : 'muted small'}>{msg}</p>}
    </div>
  );
}
