import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { getHostPass, host, photoUrl, useParty } from '../lib/store.js';
import { machineArt } from '../lib/machineArt.js';
import { photoPaths } from '../lib/photo.js';
import { fmt } from '../lib/scoring.js';
import Scanner from '../components/Scanner.jsx';
import { captureTips, GENERAL_TIPS } from '../lib/captureTips.js';

// Host "Test & calibrate": a guided matrix of machine × capture method. Each test captures, shows what
// the reader got, and records the truth so we can measure accuracy/speed and pick the best method per machine.
const METHODS = [
  { key: 'frames', label: 'Frames', mode: 'frames', fps: null, blurb: '6 sharp frames over 4 s, cropped, each read separately, then voted.' },
  { key: 'video4', label: 'Video 4', mode: 'video', fps: 4, blurb: '5-second clip, AI samples 4 frames/second.' },
  { key: 'video8', label: 'Video 8', mode: 'video', fps: 8, blurb: '5-second clip, AI samples 8 frames/second.' },
  { key: 'video15', label: 'Video 15', mode: 'video', fps: 15, blurb: '5-second clip, AI samples 15 frames/second.' },
];
const CONDITIONS = ['lights off', 'lights on', 'glare', 'multiplayer', 'alternating screen', 'close up', 'whole backbox'];
const methodOf = t => (t.method === 'video' ? `video${t.fps}` : 'frames');

const TYPE_LABEL = { '7-segment': '7-segment', alphanumeric: 'alphanumeric', 'dot-matrix': 'dot-matrix', 'modern-lcd': 'LCD' };

export default function HostTest() {
  const { machines, me } = useParty();
  const [tests, setTests] = useState([]);
  const [err, setErr] = useState('');
  const [cell, setCell] = useState(null);      // { machine, method }
  const [conds, setConds] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [review, setReview] = useState(null);  // { frame, result, ms, ... }
  const [truth, setTruth] = useState({});      // slot -> string
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('grid');    // grid | results
  const [run, setRun] = useState(null);        // guided run: { machineId, idx, results: [{label, correct, ms}], done }
  const [focus, setFocus] = useState(() => { try { return Number(localStorage.getItem('pw.testFocus')) || null; } catch { return null; } });
  const pickFocus = id => { setFocus(id); try { id ? localStorage.setItem('pw.testFocus', String(id)) : localStorage.removeItem('pw.testFocus'); } catch { /* ignore */ } };

  async function load() {
    try { setTests(await host.scanTests()); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const s = {};
    for (const t of tests) {
      const k = `${t.machine_id}:${methodOf(t)}`;
      s[k] ??= { n: 0, ok: 0, ms: 0, ai: 0 };
      s[k].n++; if (t.correct) s[k].ok++; s[k].ms += t.ms || 0; s[k].ai += (t.ms || 0) - (t.result?.captureMs || 0);
    }
    return s;
  }, [tests]);

  if (!getHostPass()) return <div className="screen"><div className="err">Unlock Host first.</div><Link className="link" to="/host">Go to Host →</Link></div>;
  if (!me) return <div className="screen"><div className="err">Join as a player on this phone first (the scanner needs a player). Then come back.</div><Link className="link" to="/join">Join →</Link></div>;

  const scope = focus ? machines.filter(m => m.id === focus) : machines;
  const nextCell = () => {
    for (const m of scope) for (const meth of METHODS) if (!stats[`${m.id}:${meth.key}`]) return { machine: m, method: meth };
    return null;
  };

  function openCell(c) { setCell(c); setReview(null); setErr(''); }

  // Guided run: every method on one machine, in order.
  function startRun(m) {
    pickFocus(m.id);
    setRun({ machineId: m.id, idx: 0, results: [], done: false });
    openCell({ machine: m, method: METHODS[0] });
  }
  function advanceRun(entry) {
    if (!run) { setCell(null); return; }
    const results = entry ? [...run.results, entry] : run.results;
    const idx = run.idx + 1;
    const m = machines.find(x => x.id === run.machineId);
    if (idx < METHODS.length) { setRun({ ...run, idx, results }); openCell({ machine: m, method: METHODS[idx] }); }
    else { setRun({ ...run, idx, results, done: true }); setCell(null); }
  }

  function onResult(r) {
    setScanning(false);
    setReview(r);
    const t = {};
    for (const s of r.result?.scores ?? []) t[s.slot] = String(s.value);
    setTruth(t);
  }

  async function save(correct) {
    setSaving(true); setErr('');
    const truthArr = Object.entries(truth)
      .map(([slot, v]) => ({ slot: Number(slot), value: Number(String(v).replace(/\D/g, '')) }))
      .filter(x => x.value > 0).sort((a, b) => a.slot - b.slot);
    const got = (review.result?.scores ?? []).map(s => `${s.slot}:${s.value}`).sort().join(',');
    const want = truthArr.map(s => `${s.slot}:${s.value}`).join(',');
    try {
      await host.logScanTest({
        machineId: cell.machine.id, method: cell.method.mode, fps: cell.method.fps, conditions: conds.join(', '),
        truth: truthArr, result: { ...(review.result ?? {}), captureMs: review.captureMs, uploadKB: review.uploadKB }, correct: correct ?? got === want, ms: review.ms,
        photoPath: review.result?.photoPath || photoPaths.get(review.frame) || null,
      });
      await load();
      const ok = correct ?? got === want;
      setReview(null);
      setErr(`Saved ✓ ${cell.machine.name} · ${cell.method.label}: ${ok ? 'right' : 'wrong'}`);
      advanceRun({ label: cell.method.label, correct: ok, ms: review.ms });
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  function bestFor(m) {
    let best = null;
    for (const meth of METHODS) {
      const st = stats[`${m.id}:${meth.key}`]; if (!st) continue;
      const score = st.ok / st.n - (st.ms / st.n) / 600000; // accuracy first, speed breaks ties
      if (!best || score > best.score) best = { meth, score, st };
    }
    return best;
  }
  // Apply this machine's winning method to it, or to every machine with the same display type.
  async function useBest(m, allOfType = false) {
    const best = bestFor(m);
    if (!best) { setErr('Test at least one method first.'); return; }
    const targets = allOfType ? machines.filter(x => x.display_type === m.display_type) : [m];
    try {
      for (const t of targets) await host.setScanMode(t.id, best.meth.mode, best.meth.fps || 4);
      setErr(`✓ ${targets.map(t => t.name).join(', ')} now use${targets.length === 1 ? 's' : ''} ${best.meth.label}.`);
    } catch (e) { setErr(e.message); }
  }

  // ---------- capture/review screen ----------
  if (cell) {
    const m = cell.machine, meth = cell.method;
    return (
      <div className="screen test-page">
        <button className="back linkbtn" onClick={() => { setCell(null); setRun(null); }}>← {run ? 'stop run' : 'test grid'}</button>
        {run && <div className="run-progress">Test {run.idx + 1} of {METHODS.length} on {m.name}{METHODS.map((x, i) => <span key={x.key} className={`rp-dot${i < run.idx ? ' done' : i === run.idx ? ' now' : ''}`} />)}</div>}
        <div className="test-head">
          <img src={machineArt(m.name)} alt="" />
          <div>
            <div className="test-machine">{m.name}</div>
            <div className="test-method">{meth.label}</div>
          </div>
        </div>
        {!review ? (
          <>
            <ol className="test-steps">
              <li>Finish a game on <strong>{m.name}</strong> (or leave its final scores showing). Multiplayer is a great test. Write down or remember the real scores.</li>
              <li><strong>Aim:</strong> {captureTips(m).aim}</li>
              {captureTips(m).note && <li>{captureTips(m).note}</li>}
              <li><strong>This test:</strong> {meth.blurb}</li>
              <li>After the 3-2-1, hold steady and tilt the phone slightly to move glare around.</li>
            </ol>
            <div className="test-conds">
              {CONDITIONS.map(c => (
                <button key={c} type="button" className={`chip${conds.includes(c) ? ' on' : ''}`}
                  onClick={() => setConds(x => x.includes(c) ? x.filter(y => y !== c) : [...x, c])}>{c}</button>
              ))}
            </div>
            <button className="cta" onClick={() => setScanning(true)}>📸 Start capture</button>
            {run && <button className="linkbtn small" onClick={() => advanceRun(null)}>Skip this method</button>}
          </>
        ) : (
          <>
            <div className="test-result">
              {review.frame && <img src={review.frame} alt="captured" />}
              <div className="test-got">
                <div className="timing">
                  <span>⏱ <strong>{(review.ms / 1000).toFixed(1)} s</strong> total</span>
                  <span>capture {(review.captureMs / 1000).toFixed(1)} s</span>
                  <span>AI {((review.ms - review.captureMs) / 1000).toFixed(1)} s</span>
                  <span>{review.uploadKB} KB sent</span>
                </div>
                <div className="muted small">Reader got{review.mode === 'video' ? ` (video ${review.fps} fps${review.clipSent ? '' : ', NO CLIP: still only'})` : ''}:</div>
                {review.result?.scores?.length
                  ? review.result.scores.map(s => <div key={s.slot} className="mono">P{s.slot}: {fmt(s.value)}</div>)
                  : <div className="muted">nothing{review.result?.note ? `: ${review.result.note}` : ''}</div>}
                {review.result?.confidence && <div className="muted small">confidence: {review.result.confidence}</div>}
              </div>
            </div>
            <button className="cta" disabled={saving} onClick={() => save(true)}>✅ Correct</button>
            <div className="card-lite">
              <div className="small"><strong>Wrong or missing?</strong> Enter what the displays really showed:</div>
              <div className="truth-grid">
                {[1, 2, 3, 4].map(slot => (
                  <label key={slot}>P{slot}
                    <input inputMode="numeric" value={truth[slot] ?? ''} placeholder="—"
                      onChange={e => setTruth(t => ({ ...t, [slot]: e.target.value.replace(/\D/g, '') }))} />
                  </label>
                ))}
              </div>
              <button className="secondary" disabled={saving} onClick={() => save(null)}>Save real scores</button>
            </div>
            <button className="linkbtn small" onClick={() => setReview(null)}>Discard and capture again</button>
            <div className="muted small">The game's over and scores are gone? Leave this screen open, play another game, then capture again.</div>
          </>
        )}
        {err && <div className="err">{err}</div>}
        {scanning && createPortal(
          <Scanner
            testMode={{ mode: meth.mode, fps: meth.fps, machineId: m.id }}
            onResult={onResult}
            onCancel={() => setScanning(false)}
            onFallback={() => { setScanning(false); setErr('Camera unavailable on this device/browser.'); }}
            onDone={() => setScanning(false)}
          />,
          document.body,
        )}
      </div>
    );
  }

  // ---------- end of a guided run ----------
  if (run?.done) {
    const m = machines.find(x => x.id === run.machineId);
    const best = bestFor(m);
    const sameType = machines.filter(x => x.display_type === m.display_type);
    return (
      <div className="screen test-page">
        <h1>{m.name}: done 🎉</h1>
        <div className="card-lite">
          {run.results.map((r, i) => <div key={i} className="tr-row"><span>{r.label}</span><span>{r.correct ? '✅' : '❌'} {(r.ms / 1000).toFixed(1)} s total</span></div>)}
          {!run.results.length && <div className="muted small">All methods skipped.</div>}
        </div>
        {best && (
          <div className="card-lite">
            <div>Best so far for {m.name}: <strong>{best.meth.label}</strong> ({best.st.ok}/{best.st.n} right, {(best.st.ms / best.st.n / 1000).toFixed(1)} s)</div>
            <button className="cta" onClick={() => useBest(m)}>Use {best.meth.label} for {m.name}</button>
            {sameType.length > 1 && <button className="secondary" onClick={() => useBest(m, true)}>Use for all {TYPE_LABEL[m.display_type] || m.display_type} machines ({sameType.map(x => x.name).join(', ')})</button>}
          </div>
        )}
        {err && <div className={/^(✓|Saved)/.test(err) ? 'ok' : 'err'}>{err}</div>}
        <button className="secondary" onClick={() => startRun(m)}>↻ Run {m.name} again</button>
        {(() => { const nx = machines.find(x => x.id !== m.id && !METHODS.some(meth => stats[`${x.id}:${meth.key}`])); return nx ? <button className="cta" onClick={() => startRun(nx)}>▶ Next machine: {nx.name}</button> : null; })()}
        <button className="linkbtn small" onClick={() => setRun(null)}>Back to the grid</button>
      </div>
    );
  }

  // ---------- grid / results ----------
  const done = Object.keys(stats).filter(k => scope.some(m => k.startsWith(m.id + ':'))).length, total = scope.length * METHODS.length;
  return (
    <div className="screen test-page">
      <Link className="back" to="/host">← Host</Link>
      <h1>🧪 Test &amp; calibrate</h1>
      <p className="muted small">Each cell is one machine × one capture method. Test as many as you can: {done}/{total} tried, {tests.length} captures logged.</p>
      <div className="row gap">
        <button className={`chip${view === 'grid' ? ' on' : ''}`} onClick={() => setView('grid')}>Test grid</button>
        <button className={`chip${view === 'results' ? ' on' : ''}`} onClick={() => setView('results')}>Results</button>
      </div>
      {err && <div className={/^(✓|Saved)/.test(err) ? 'ok' : 'err'}>{err}</div>}

      <div className="test-focus">
        <span className="muted small">Machine:</span>
        <button className={`chip${!focus ? ' on' : ''}`} onClick={() => pickFocus(null)}>All</button>
        {machines.map(m => <button key={m.id} className={`chip${focus === m.id ? ' on' : ''}`} onClick={() => pickFocus(m.id)}>{m.name}</button>)}
      </div>

      {view === 'grid' ? (
        <>
          <details className="card-lite tips-card"><summary><strong>How to capture (read once)</strong></summary><ul>{GENERAL_TIPS.map(t => <li key={t}>{t}</li>)}</ul></details>
          {focus
            ? <button className="cta" onClick={() => startRun(machines.find(x => x.id === focus))}>▶ Run all {METHODS.length} tests on {machines.find(x => x.id === focus)?.name}</button>
            : <div className="muted small">Pick a machine above to run its guided test, or tap any cell.</div>}
          {nextCell()
            ? <button className="secondary" onClick={() => openCell(nextCell())}>Single test: {nextCell().machine.name} · {nextCell().method.label}</button>
            : <div className="ok">All methods tried{focus ? ' on this machine' : ''}. Tap any cell to test it again, or see Results.</div>}
          <div className="test-grid">
            <div />{METHODS.map(m => <div key={m.key} className="tg-head">{m.label}</div>)}
            {scope.map(m => (
              <FragmentRow key={m.id} m={m} stats={stats} onPick={meth => openCell({ machine: m, method: meth })} />
            ))}
          </div>
        </>
      ) : (
        <div className="test-results">
          {scope.map(m => (
            <div key={m.id} className="card-lite">
              <div className="row spread"><strong>{m.name}</strong><span className="muted small">now: {m.scan_mode === 'video' ? `video ${m.scan_fps}` : 'frames'}</span></div>
              {METHODS.map(meth => {
                const st = stats[`${m.id}:${meth.key}`];
                return <div key={meth.key} className="tr-row"><span>{meth.label}</span><span className="mono">{st ? `${st.ok}/${st.n} right · ${(st.ms / st.n / 1000).toFixed(1)} s (AI ${(st.ai / st.n / 1000).toFixed(1)})` : '—'}</span></div>;
              })}
              <div className="row gap">
                <button className="ghost" onClick={() => useBest(m)}>Use best for {m.name}</button>
                {machines.filter(x => x.display_type === m.display_type).length > 1 && <button className="ghost" onClick={() => useBest(m, true)}>…for all {TYPE_LABEL[m.display_type]}</button>}
              </div>
            </div>
          ))}
          <div className="card-lite">
            <strong>Recent captures</strong>
            {[...tests].reverse().slice(0, 30).map(t => (
              <div key={t.id} className="tr-row small">
                <span>{machines.find(m => m.id === t.machine_id)?.name} · {methodOf(t)}{t.conditions ? ` · ${t.conditions}` : ''}</span>
                <span>{t.correct ? '✅' : '❌'} {(t.ms / 1000).toFixed(1)}s {t.photo_path && <a className="link" href={photoUrl(t.photo_path)} target="_blank" rel="noreferrer">photo</a>}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow({ m, stats, onPick }) {
  return (
    <>
      <div className="tg-machine">{m.name}<div className="muted small">{m.scan_mode === 'video' ? `video ${m.scan_fps}` : 'frames'}</div></div>
      {METHODS.map(meth => {
        const st = stats[`${m.id}:${meth.key}`];
        const cls = !st ? '' : st.ok === st.n ? ' good' : st.ok === 0 ? ' bad' : ' mixed';
        return (
          <button key={meth.key} className={`tg-cell${cls}`} onClick={() => onPick(meth)}>
            {st ? `${st.ok}/${st.n}` : '+'}
          </button>
        );
      })}
    </>
  );
}
