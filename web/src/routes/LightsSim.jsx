// /lights-sim: shows, live, what the garage strips are doing. It listens to every command the TV
// sends (to the real controller, or to the simulator in dry-run mode) and has its own event buttons.
// "Simulator only" plays effects here and sends nothing; "Send to hardware" plays them on the strips too.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ensureLightsTopic, useParty } from '../lib/store.js';
import { LIGHTS, defaultZones, bandOf } from '../lib/lights/config.js';
import { LightsEngine } from '../lib/lights/engine.js';
import { runControl } from '../lib/lights/useLightsDirector.js';
import { publish, subscribe, onConnection } from '../lib/lights/mqtt.js';
import { applyMessage, newModel, renderRange } from '../lib/lights/render.js';
import { buildPresets } from '../lib/lights/presets.js';

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
  const [music, setMusic] = useState('');
  const [mic, setMic] = useState('off'); // off | on | denied
  const [ambientLabel, setAmbientLabel] = useState('');
  const audioRef = useRef(null);
  const [tvMode, setTvMode] = useState('demo'); // demo | live | off
  // This page's private channel for its TV view, so other open simulators (or test runs) don't mix in.
  const [ch] = useState(() => Math.random().toString(36).slice(2, 12));
  useEffect(() => { ensureLightsTopic(); }, []); // with the host unlock, also show the real controller's traffic
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

  // The controller's own presets (standalone shows). A message with `ps` plays that preset here the
  // way WLED would: playlists step through their items (every 8 s here, so you can see them all).
  const presets = useMemo(() => buildPresets(zones), [JSON.stringify(zones)]); // eslint-disable-line react-hooks/exhaustive-deps
  const playTimer = useRef(null);
  const curPreset = useRef(1);
  const [standalone, setStandalone] = useState('');
  const feedRef = useRef(null);
  feedRef.current = msg => {
    if (!msg || typeof msg !== 'object') return;
    const { ps, ...rest } = msg;
    if (Object.keys(rest).length) applyMessage(model.current, rest);
    if (ps === undefined) return;
    let id = Number(ps);
    const cyc = typeof ps === 'string' && ps.match(/^(\d+)~(\d+)~$/);
    if (cyc) { const a = +cyc[1], b = +cyc[2]; id = curPreset.current >= a && curPreset.current < b ? curPreset.current + 1 : a; }
    const pr = presets[id];
    if (!pr) return;
    if (pr.ps !== undefined) { feedRef.current({ ps: pr.ps }); return; }
    curPreset.current = id; setStandalone(String(id));
    clearInterval(playTimer.current); playTimer.current = null;
    const apply = item => applyMessage(model.current, item.seg ? { on: item.on, bri: item.bri, seg: item.seg } : { on: item.on });
    if (pr.playlist) {
      let i = 0;
      apply(presets[pr.playlist.ps[0]]);
      playTimer.current = setInterval(() => { i = (i + 1) % pr.playlist.ps.length; apply(presets[pr.playlist.ps[i]]); }, 8000);
    } else apply(pr);
  };
  useEffect(() => () => clearInterval(playTimer.current), []);

  // Live traffic from the TV (real or dry-run).
  useEffect(() => {
    const show = (src) => msg => {
      feedRef.current(msg);
      setLog(l => [{ at: new Date().toLocaleTimeString(), src, msg: JSON.stringify(msg).slice(0, 160) }, ...l].slice(0, 12));
    };
    const a = subscribe('api', show('hardware')), b = subscribe('sim', show('simulator'));
    const d = subscribe(`~/wpsim/${ch}`, show('TV view'));
    const c = onConnection(setConn);
    return () => { a(); b(); c(); d(); };
  }, []);

  // This page's own engine for the event buttons.
  const engine = useMemo(() => new LightsEngine({
    zones, timeScale: speed,
    send: msg => {
      if (hardware) { publish('api', msg); return; } // comes back through the live subscription
      feedRef.current(msg);
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
  useEffect(() => { engine.setMusic(music || null); if (music) setAmbientLabel(''); }, [engine, music]);

  // Sound: the Mac's microphone through the Web Audio analyser (like the Gledopto's mic), or a fake
  // 120 BPM beat when the mic is off, so the sound-reactive effects always move.
  useEffect(() => {
    let raf;
    const tick = () => {
      const a = audioRef.current, m = model.current.audio;
      if (a) {
        a.an.getByteFrequencyData(a.freq);
        a.an.getByteTimeDomainData(a.wave);
        let rms = 0; for (const v of a.wave) rms += ((v - 128) / 128) ** 2;
        rms = Math.sqrt(rms / a.wave.length);
        a.agc = Math.max(rms, a.agc * 0.995, 0.02); // automatic gain
        m.level = Math.min(1, rms / a.agc);
        const bins = a.freq.length;
        for (let b = 0; b < 16; b++) { // log-spaced bands
          const lo = Math.floor(Math.pow(bins, b / 16)), hi = Math.max(lo + 1, Math.floor(Math.pow(bins, (b + 1) / 16)));
          let t = 0; for (let k = lo; k < hi; k++) t += a.freq[k]; m.bands[b] = t / (hi - lo) / 255;
        }
        const bass = (m.bands[0] + m.bands[1] + m.bands[2]) / 3;
        a.bassAvg = a.bassAvg * 0.95 + bass * 0.05;
        m.beat = bass > a.bassAvg * 1.35 && bass > 0.25;
      } else {
        const t = performance.now() / 500; // 120 BPM
        const pulse = Math.max(0, 1 - (t % 1) * 2.2);
        m.level = 0.25 + 0.6 * pulse + 0.1 * Math.random();
        m.bands = m.bands.map((_, b) => Math.max(0, (b < 3 ? pulse : 0.3 + 0.3 * Math.sin(t * 2 + b)) * (0.7 + 0.3 * Math.random())));
        m.beat = pulse > 0.95;
      }
      raf = setTimeout(tick, 25);
    };
    tick();
    return () => clearTimeout(raf);
  }, []);
  async function toggleMic() {
    if (audioRef.current) { audioRef.current.stream.getTracks().forEach(tr => tr.stop()); audioRef.current.ctx.close(); audioRef.current = null; setMic('off'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(stream).connect(an);
      audioRef.current = { stream, ctx, an, freq: new Uint8Array(an.frequencyBinCount), wave: new Uint8Array(an.fftSize), agc: 0.05, bassAvg: 0.2 };
      setMic('on');
    } catch { setMic('denied'); }
  }

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
  // Draw the curb directly under the beam band (the stretch of the beam over the machines).
  const curbShift = Math.max(0, bandOf(zones).start - LIGHTS.runs.top.start);

  return (
    <div className="ls-page">
      <div className="ls-head">
        <h1>Garage lights simulator</h1>
        <span className={`ls-dot ${conn ? 'ok' : 'bad'}`} /> {conn ? 'Connected' : 'Connecting…'}
        <Link to="/host" className="ls-back">← Host</Link>
      </div>

      <div className="ls-row">
        <span className="ls-label" style={{ margin: 0 }}>TV board</span>
        {[['demo', 'TV demo'], ['live', 'Live party'], ['off', 'Hide TV']].map(([k, l]) => (
          <label key={k} className="ls-mode"><input type="radio" checked={tvMode === k} onChange={() => setTvMode(k)} /> {l}</label>
        ))}
        <span className="ls-dim">The TV's events drive these strips (simulator only, never the real ones).</span>
      </div>
      {tvMode !== 'off' && (
        <div className="ls-tv">
          <iframe key={tvMode} title="TV board" src={`${tvMode === 'demo' ? '/tv?demo&lights=sim' : '/tv?lights=sim'}&ch=${ch}`} />
        </div>
      )}

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
        <div className="ls-label">Curb run, behind the machines ({LIGHTS.runs.curb.stop - LIGHTS.runs.curb.start} px), lined up under the beam</div>
        <div className="ls-scroll">
          <div style={{ position: 'relative', width: W(LIGHTS.runs.curb), marginLeft: curbShift * PX }}>
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
        <div className="ls-row">
          <label>Music mode
            <select value={music} onChange={e => setMusic(e.target.value)}>
              <option value="">Off (ambient effects rotate)</option>
              {Object.entries(LIGHTS.music).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </label>
          <span className="ls-buttons"><button type="button" onClick={toggleMic}>{mic === 'on' ? 'Stop listening' : 'Listen with this Mac\'s mic'}</button></span>
          <span className="ls-dim">{mic === 'on' ? 'Listening to the room' : mic === 'denied' ? 'Mic blocked: allow it in the browser' : 'No mic: using a fake 120 BPM beat'}</span>
        </div>
        <div className="ls-row">
          <label>Standalone (no TV)
            <select value={standalone} onChange={e => {
              const v = e.target.value; if (!v) return;
              setTvMode('off'); engine.clearAll(); engine.stopCycle();
              if (hardware) publish('api', { ps: Number(v) }); else feedRef.current({ ps: Number(v) });
            }}>
              <option value="">Pick a controller preset…</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map(id => <option key={id} value={id}>{presets[id].n}</option>)}
            </select>
          </label>
          <span className="ls-buttons"><button type="button" onClick={() => {
            setTvMode('off'); engine.clearAll(); engine.stopCycle();
            if (hardware) publish('api', { ps: '1~4~' }); else feedRef.current({ ps: '1~4~' });
          }}>Next mode (controller button)</button></span>
          <span className="ls-dim">What the lights do on their own when the wall switch is flipped (boots into Attract).</span>
        </div>
        <div className="ls-row">
          <label>Ambient
            <select value={ambientLabel} onChange={e => {
              const v = e.target.value;
              if (v === 'preset') { fire('ambient'); setAmbientLabel('preset'); return; }
              if (!engine.cycleTimer) engine.start(); // the party base has to be on to preview it
              setMusic('');
              engine.setAmbient(LIGHTS.ambientCycle.findIndex(a => a.fx === v));
              setAmbientLabel(engine.ambientName());
            }}>
              <option value="preset">Your attract loop (WLED preset 1)</option>
              {LIGHTS.ambientCycle.map(a => <option key={a.fx} value={a.fx}>{a.fx}</option>)}
            </select>
          </label>
          <span className="ls-buttons"><button type="button" onClick={() => { if (!engine.cycleTimer) engine.start(); engine.nextAmbient(); setAmbientLabel(engine.ambientName()); }}>Next ambient effect</button></span>
          <span className="ls-dim">During the party these rotate every {LIGHTS.ambientMinutes} min.</span>
        </div>
        <div className="ls-row ls-buttons">
          <button type="button" onClick={() => fire('score')}>Score</button>
          <button type="button" onClick={() => fire('champion')}>Machine record</button>
          <button type="button" onClick={() => fire('leader')}>New #1</button>
          <button type="button" onClick={() => fire('ranked')}>Player ranked</button>
          <button type="button" onClick={() => fire('milestone')}>Games milestone</button>
          <button type="button" onClick={() => fire('shame')}>Wall of Shame</button>
          <button type="button" onClick={() => { fire('open'); setAmbientLabel(engine.ambientName()); }}>Party open</button>
          <button type="button" onClick={() => fire('close')}>Party close</button>
          <button type="button" onClick={revealDemo}>Winner reveal</button>
          <button type="button" onClick={() => { fire('house', { on: !house }); setHouse(!house); }}>{house ? 'House lights off' : 'House lights'}</button>
        </div>
        <dl className="ls-legend">
          <dt>Score on a cabinet</dt><dd>that machine breathes, player color ↔ machine color (top and curb)</dd>
          <dt>Machine record</dt><dd>white flashes, then the machine's colors chase out from its center</dd>
          <dt>New #1</dt><dd>white bounces top ↔ curb, then the room washes in their color</dd>
          <dt>Player ranked</dt><dd>the room breathes once in their color</dd>
          <dt>Games milestone</dt><dd>gold bounces top ↔ curb</dd>
          <dt>Wall of Shame</dt><dd>the room sags to a slow, dim red</dd>
          <dt>Party open</dt><dd>a sweep, then the ambient effects start</dd>
          <dt>Party close</dt><dd>machines off, back to your WLED attract preset</dd>
          <dt>Winner reveal</dt><dd>follows each reveal slide; the grand champion gets a build, a burst and three white flashes</dd>
          <dt>Joins, PBs, climbs, spotlights</dt><dd>no extra effect</dd>
        </dl>
      </div>

      <div className="ls-log">
        <div className="ls-label">Live commands (from the TV and this page)</div>
        {log.length ? log.map((l, i) => <div key={i}><b>{l.at}</b> [{l.src}] {l.msg}</div>) : <div className="ls-dim">Nothing yet. Commands the TV sends show up here.</div>}
      </div>
    </div>
  );
}
