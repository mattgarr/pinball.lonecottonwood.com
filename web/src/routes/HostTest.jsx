import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { getHostPass, host, photoUrl, useParty } from '../lib/store.js';
import { machineArt } from '../lib/machineArt.js';
import { photoPaths } from '../lib/photo.js';
import { fmt } from '../lib/scoring.js';
import Scanner from '../components/Scanner.jsx';

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

function framingTip(m) {
  if (m?.display_type === '7-segment') return 'Frame the whole backglass so all four score displays are in the box.';
  if (m?.display_type === 'alphanumeric') return 'Fill the box with the score display panel under the backglass.';
  return 'Fill the box with just the score screen.';
}

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
      s[k] ??= { n: 0, ok: 0, ms: 0 };
      s[k].n++; if (t.correct) s[k].ok++; s[k].ms += t.ms || 0;
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
        truth: truthArr, result: review.result ?? null, correct: correct ?? got === want, ms: review.ms,
        photoPath: review.result?.photoPath || photoPaths.get(review.frame) || null,
      });
      await load();
      setReview(null);
      setCell(null); // back to the grid for this machine; "Next" continues
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function useBest(m) {
    let best = null;
    for (const meth of METHODS) {
      const st = stats[`${m.id}:${meth.key}`]; if (!st) continue;
      const score = st.ok / st.n - (st.ms / st.n) / 600000; // accuracy first, speed breaks ties
      if (!best || score > best.score) best = { meth, score };
    }
    if (!best) return;
    try { await host.setScanMode(m.id, best.meth.mode, best.meth.fps || 4); setErr(`✓ ${m.name} now uses ${best.meth.label}.`); }
    catch (e) { setErr(e.message); }
  }

  // ---------- capture/review screen ----------
  if (cell) {
    const m = cell.machine, meth = cell.method;
    return (
      <div className="screen test-page">
        <button className="back linkbtn" onClick={() => setCell(null)}>← test grid</button>
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
              <li>Finish a game on <strong>{m.name}</strong> (or leave its final scores showing). Multiplayer is a great test.</li>
              <li><strong>Framing:</strong> {framingTip(m)}</li>
              <li><strong>Method:</strong> {meth.blurb}</li>
              <li>Hold on the display. Tilt the phone slightly to move the glare around.</li>
            </ol>
            <div className="test-conds">
              {CONDITIONS.map(c => (
                <button key={c} type="button" className={`chip${conds.includes(c) ? ' on' : ''}`}
                  onClick={() => setConds(x => x.includes(c) ? x.filter(y => y !== c) : [...x, c])}>{c}</button>
              ))}
            </div>
            <button className="cta" onClick={() => setScanning(true)}>📸 Start capture</button>
          </>
        ) : (
          <>
            <div className="test-result">
              {review.frame && <img src={review.frame} alt="captured" />}
              <div className="test-got">
                <div className="muted small">Reader got ({(review.ms / 1000).toFixed(1)} s{review.mode === 'video' ? `, video ${review.fps} fps${review.clipSent ? '' : ', NO CLIP: still only'}` : ''}):</div>
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
      {err && <div className={err.startsWith('✓') ? 'ok' : 'err'}>{err}</div>}

      <div className="test-focus">
        <span className="muted small">Machine:</span>
        <button className={`chip${!focus ? ' on' : ''}`} onClick={() => pickFocus(null)}>All</button>
        {machines.map(m => <button key={m.id} className={`chip${focus === m.id ? ' on' : ''}`} onClick={() => pickFocus(m.id)}>{m.name}</button>)}
      </div>

      {view === 'grid' ? (
        <>
          {nextCell()
            ? <button className="cta" onClick={() => openCell(nextCell())}>▶ Next: {nextCell().machine.name} · {nextCell().method.label}</button>
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
                return <div key={meth.key} className="tr-row"><span>{meth.label}</span><span className="mono">{st ? `${st.ok}/${st.n} right · ${(st.ms / st.n / 1000).toFixed(1)} s` : '—'}</span></div>;
              })}
              <button className="ghost" onClick={() => useBest(m)}>Use best for {m.name}</button>
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
      <div className="tg-machine">{m.name}</div>
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
