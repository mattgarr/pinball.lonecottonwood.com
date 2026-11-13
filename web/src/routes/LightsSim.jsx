// /lights-sim: shows, live, what the garage strips are doing. It listens to every command the TV
// sends (to the real controller, or to the simulator in dry-run mode) and has its own event buttons.
// "Simulator only" plays effects here and sends nothing; "Send to hardware" plays them on the strips too.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ensureLightsTopic, useParty } from '../lib/store.js';
import { LIGHTS, defaultZones } from '../lib/lights/config.js';
import { LightsEngine } from '../lib/lights/engine.js';
import { runControl } from '../lib/lights/useLightsDirector.js';
import { publish, subscribe, onConnection } from '../lib/lights/mqtt.js';
import { applyMessage, newModel, renderRange } from '../lib/lights/render.js';
import { buildPresets } from '../lib/lights/presets.js';
import { uncalPayload } from '../lib/lights/colorCal.js';
import LightsWall from '../components/LightsWall.jsx';

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
  const [tvMode, setTvMode] = useState('demo'); // demo | reveal | live | off
  const [panel, setPanel] = useState('moments'); // moments | offline | look
  // This page's private channel for its TV view, so other open simulators (or test runs) don't mix in.
  const [ch] = useState(() => Math.random().toString(36).slice(2, 12));
  useEffect(() => { ensureLightsTopic(); }, []); // with the host unlock, also show the real controller's traffic
  const model = useRef(newModel());
  const nameOf = id => allMachines.find(m => m.id === id)?.name || `#${id}`;
  const shortName = id => { const n = nameOf(id); return /dragons/i.test(n) ? 'D&D' : n.split(' ')[0]; };

  // Seed the model with the current layout so zones and base segments render before any traffic.
  useEffect(() => {
    const seed = new LightsEngine({ send: msg => applyMessage(model.current, msg), zones });
    seed.applyLayout(zones); seed.flush(); seed.destroy();
  }, [JSON.stringify(zones)]); // eslint-disable-line react-hooks/exhaustive-deps

  // The controller's own presets (standalone shows). A message with `ps` plays that preset here the
  // way WLED would: playlists step through their items (every 8 s here, so you can see them all).
  const presets = useMemo(() => buildPresets(zones, { calibrate: false }), [JSON.stringify(zones)]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // The remote, the wall switch and the controller's button: what the lights do with no TV or app.
  const [bri, setBri] = useState(170);
  const remote = msg => {
    setTvMode('off'); engine.clearAll(); engine.stopCycle();
    if (msg.bri !== undefined) setBri(msg.bri);
    if (msg.on === false) setStandalone('');
    if (hardware) publish('api', msg); else feedRef.current(msg);
  };

  // Live traffic from the TV (real or dry-run).
  useEffect(() => {
    // The strip's own topic carries warm-corrected colors (colorCal.js): undo that to draw them here.
    const show = (src) => msg => {
      feedRef.current(src === 'hardware' ? uncalPayload(msg) : msg);
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


  // Moments the TV shows (scores, records, #1…): with the TV view on, the button makes the TV show it
  // and the lights follow the TV, as at the party. (With "send to hardware", the real strips get it too.)
  const tvFrame = useRef(null);
  const TV_MOMENTS = ['score', 'champion', 'leader', 'ranked', 'milestone', 'shame'];
  const fire = (cmd, extra = {}) => {
    const viaTv = TV_MOMENTS.includes(cmd) && (tvMode === 'demo' || tvMode === 'live') && tvFrame.current?.contentWindow;
    if (viaTv) tvFrame.current.contentWindow.postMessage({ type: 'pw-sim', kind: cmd, machineId }, location.origin);
    if (!viaTv || hardware) runControl(engine, { cmd, machineId, color, at: Date.now(), ...extra });
  };
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


  const MOMENTS = [
    ['score', 'Score', 'That machine breathes, player color ↔ machine color'],
    ['champion', 'High score', 'A new #1 on a machine: white flashes, then the machine\'s colors chase out from its center'],
    ['leader', 'New #1', 'White bounces top ↔ curb, then the room washes in their color'],
    ['ranked', 'Player ranked', 'The room breathes once in their color'],
    ['milestone', 'Milestone', 'A games-played milestone: gold bounces top ↔ curb'],
    ['shame', 'Wall of Shame', 'The room sags to a slow, dim red'],
  ];
  const SHORT = { 1: 'Attract', 2: 'Calm', 3: 'Exciting', 4: 'Music', 5: 'Showcase', 6: 'Cozy', 7: 'House' };
  const tvSrc = `${tvMode === 'demo' ? '/tv?demo&lights=sim' : tvMode === 'reveal' ? '/tv?reveal&lights=sim' : '/tv?lights=sim'}&ch=${ch}`;

  return (
    <div className="ls-page">
      <div className="ls-head">
        <h1>Garage lights simulator</h1>
        <span className="ls-conn"><span className={`ls-dot ${conn ? 'ok' : 'bad'}`} />{conn ? 'Connected' : 'Connecting…'}</span>
        <div className="ls-seg" role="group" aria-label="Where effects go">
          <button type="button" className={!hardware ? 'on' : ''} onClick={() => setHardware(false)}>Simulator only</button>
          <button type="button" className={hardware ? 'on' : ''} onClick={() => setHardware(true)}>Real lights too</button>
        </div>
        <label className="ls-pick">Speed
          <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
            <option value={1}>Normal</option><option value={2}>½ speed</option><option value={4}>¼ speed</option>
          </select>
        </label>
        <Link to="/host" className="ls-back">← Host</Link>
      </div>

      <div className={`ls-main${tvMode === 'off' ? ' no-tv' : ''}`}>
        <div className="ls-stage">
          <div className="ls-seg" role="group" aria-label="TV view">
            {[['demo', 'TV demo'], ['reveal', 'Winner reveal'], ['live', 'Live party'], ['off', 'Hide TV']].map(([k, l]) => (
              <button key={k} type="button" className={tvMode === k ? 'on' : ''} onClick={() => setTvMode(k)}>{l}</button>
            ))}
          </div>
          {tvMode !== 'off' && (
            <div className="ls-tv"><iframe ref={tvFrame} key={tvMode} title="TV board" src={tvSrc} /></div>
          )}
          <LightsWall model={model} speed={speed} zones={zones} nameOf={nameOf} />
          {tvMode === 'reveal' && <div className="ls-dim ls-note">Click the TV to go to the next prize.</div>}
        </div>

        <div className="ls-side">
        <div className="ls-panel">
          <div className="ls-tabs" role="tablist">
            {[['moments', 'Moments'], ['offline', 'No TV'], ['look', 'Ambient']].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={panel === k} className={panel === k ? 'on' : ''} onClick={() => setPanel(k)}>{l}</button>
            ))}
          </div>

          {panel === 'moments' && (
            <div className="ls-tabbody">
              <label className="ls-field">Machine
                <select value={machineId} onChange={e => setMachineId(Number(e.target.value))}>
                  {LIGHTS.machineOrder.map(id => <option key={id} value={id}>{nameOf(id)}</option>)}
                </select>
              </label>
              {(tvMode === 'off' || hardware) && (
                <div className="ls-colors" aria-label="Player color">
                  {COLORS.map(c => <button key={c} type="button" className={`ls-color${c === color ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}
                </div>
              )}
              <div className="ls-grid">
                {MOMENTS.map(([cmd, label, what]) => <button key={cmd} type="button" title={what} onClick={() => fire(cmd)}>{label}</button>)}
              </div>
              <div className="ls-grid">
                <button type="button" title="A sweep, then the ambient effects start" onClick={() => { fire('open'); setAmbientLabel(engine.ambientName()); }}>Party open</button>
                <button type="button" title="Machines off, back to your controller's Attract show" onClick={() => fire('close')}>Party close</button>
                <button type="button" title="Each prize: a 3-2-1, then the winner" onClick={() => (tvMode === 'off' ? revealDemo() : setTvMode('reveal'))}>Winner reveal</button>
                <button type="button" className={house ? 'on' : ''} onClick={() => { fire('house', { on: !house }); setHouse(!house); }}>{house ? 'House lights: on' : 'House lights'}</button>
              </div>
              <div className="ls-dim ls-note">{tvMode === 'off' ? 'TV hidden: buttons go straight to the lights.' : 'Buttons make the TV show the moment; the lights follow the TV.'} Hover a button to see what the lights do.</div>
            </div>
          )}

          {panel === 'offline' && (
            <div className="ls-tabbody">
              <div className="ls-sub">Wall switch</div>
              <div className="ls-grid">
                <button type="button" title="Power on: the Attract show starts" onClick={() => remote({ on: true, ps: 1 })}>On</button>
                <button type="button" onClick={() => remote({ on: false })}>Off</button>
              </div>
              <div className="ls-sub">Remote</div>
              <div className="ls-grid">
                <button type="button" onClick={() => remote({ on: true })}>On</button>
                <button type="button" onClick={() => remote({ on: false })}>Off</button>
                <button type="button" aria-label="Brightness down" onClick={() => remote({ bri: Math.max(10, bri - 40) })}>Dim −</button>
                <button type="button" aria-label="Brightness up" onClick={() => remote({ bri: Math.min(255, bri + 40) })}>Bright +</button>
              </div>
              <div className="ls-grid">
                {[1, 2, 3, 4, 5, 6, 7].map(id => (
                  <button key={id} type="button" className={standalone === String(id) ? 'on' : ''} onClick={() => remote({ ps: id })} title={presets[id].n}>{id} · {SHORT[id]}</button>
                ))}
              </div>
              <div className="ls-sub">Button on the controller</div>
              <div className="ls-grid ls-grid-3">
                <button type="button" title="Next show" onClick={() => remote({ ps: presets[9].ps })}>Press</button>
                <button type="button" title="House lights" onClick={() => remote({ ps: 7 })}>Double</button>
                <button type="button" title="Off" onClick={() => remote({ ps: 8 })}>Long</button>
              </div>
              <div className="ls-dim ls-note">Press: next show · Double: house lights · Long: off. Shows step every 8 s here (minutes on the real lights).</div>
            </div>
          )}

          {panel === 'look' && (
            <div className="ls-tabbody">
              <label className="ls-field">Ambient effect
                <select value={ambientLabel} onChange={e => {
                  const v = e.target.value;
                  if (v === 'preset') { fire('ambient'); setAmbientLabel('preset'); return; }
                  if (!engine.cycleTimer) engine.start();
                  setMusic('');
                  engine.setAmbient(LIGHTS.ambientCycle.findIndex(a => a.fx === v));
                  setAmbientLabel(engine.ambientName());
                }}>
                  <option value="preset">Your controller's Attract show</option>
                  {LIGHTS.ambientCycle.map(a => <option key={a.fx} value={a.fx}>{a.fx}</option>)}
                </select>
              </label>
              <div className="ls-grid">
                <button type="button" onClick={() => { if (!engine.cycleTimer) engine.start(); engine.nextAmbient(); setAmbientLabel(engine.ambientName()); }}>Next ambient</button>
              </div>
              <div className="ls-dim ls-note">During the party these rotate every {LIGHTS.ambientMinutes} min.</div>
              <label className="ls-field">Music mode
                <select value={music} onChange={e => setMusic(e.target.value)}>
                  <option value="">Off (ambient effects rotate)</option>
                  {Object.entries(LIGHTS.music).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>
              </label>
              <div className="ls-grid ls-grid-1">
                <button type="button" className={mic === 'on' ? 'on' : ''} onClick={toggleMic}>{mic === 'on' ? 'Stop listening' : 'Listen with mic'}</button>
              </div>
              <div className="ls-dim ls-note">{mic === 'on' ? 'Listening to the room.' : mic === 'denied' ? 'Mic blocked: allow it in the browser.' : 'No mic: a fake 120 BPM beat drives the music effects.'}</div>
            </div>
          )}
        </div>
        <details className="ls-log">
        <summary>Command log ({log.length})</summary>
        {log.length ? log.map((l, i) => <div key={i}><b>{l.at}</b> [{l.src}] {l.msg}</div>) : <div className="ls-dim">Nothing yet.</div>}
      </details>
        </div>
      </div>


    </div>
  );
}
