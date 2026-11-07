import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { getHostPass, host, photoUrl, useParty } from '../lib/store.js';
import { machineArt } from '../lib/machineArt.js';
import { photoPaths } from '../lib/photo.js';
import { fmt } from '../lib/scoring.js';
import { captureTips, GENERAL_TIPS } from '../lib/captureTips.js';
import Scanner from '../components/Scanner.jsx';

// Host "Test & calibrate": ONE capture per machine. The scanner records 5 seconds once and runs every
// method on that same footage (burst clip, 5 s clip, still frames), timing each. The host confirms the
// real scores once; we log a result per method and recommend the best method per machine / display type.
const METHODS = [
  { key: 'burst', label: 'Burst', mode: 'burst', fps: 10 },
  { key: 'video', label: 'Video 5s', mode: 'video', fps: 8 },
  { key: 'frames', label: 'Frames', mode: 'frames', fps: null },
];
const methodKey = t => (t.method === 'burst' ? 'burst' : t.method === 'video' ? 'video' : 'frames');
const CONDITIONS = ['lights off', 'lights on', 'glare', 'multiplayer', 'alternating screen'];
const TYPE_LABEL = { '7-segment': '7-segment', alphanumeric: 'alphanumeric', 'dot-matrix': 'dot-matrix', 'modern-lcd': 'LCD' };
const sec = ms => (ms == null ? '?' : (ms / 1000).toFixed(1));
const scoresKey = arr => (arr ?? []).filter(s => s.value > 0).map(s => `${s.slot}:${s.value}`).sort().join(',');

export default function HostTest() {
  const { machines, me } = useParty();
  const [tests, setTests] = useState([]);
  const [err, setErr] = useState('');
  const [machine, setMachine] = useState(null);  // machine being calibrated
  const [conds, setConds] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [review, setReview] = useState(null);    // { all: [...] }
  const [truth, setTruth] = useState({});
  const [saved, setSaved] = useState(null);      // per-method verdicts after save
  const [busy, setBusy] = useState(false);

  async function load() { try { setTests(await host.scanTests()); } catch (e) { setErr(e.message); } }
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const s = {};
    for (const t of tests) {
      const k = `${t.machine_id}:${methodKey(t)}`;
      s[k] ??= { n: 0, ok: 0, hi: 0, ms: 0 };
      s[k].n++; if (t.correct) s[k].ok++; if (t.result?.confidence === 'high') s[k].hi++; s[k].ms += t.ms || 0;
    }
    return s;
  }, [tests]);

  if (!getHostPass()) return <div className="screen"><div className="err">Unlock Host first.</div><Link className="link" to="/host">Host →</Link></div>;
  if (!me) return <div className="screen"><div className="err">Join as a player on this phone first.</div><Link className="link" to="/join">Join →</Link></div>;

  function bestFor(m) {
    let best = null;
    for (const meth of METHODS) {
      const st = stats[`${m.id}:${meth.key}`]; if (!st) continue;
      // accuracy first, then how often it's sure (fewer double-checks), then speed
      const score = st.ok / st.n + 0.2 * (st.hi / st.n) - (st.ms / st.n) / 100000;
      if (!best || score > best.score) best = { meth, st, score };
    }
    return best;
  }
  async function useBest(m, allOfType = false) {
    const best = bestFor(m);
    if (!best) return;
    const targets = allOfType ? machines.filter(x => x.display_type === m.display_type) : [m];
    try {
      for (const t of targets) await host.setScanMode(t.id, best.meth.mode, best.meth.fps || 4);
      setErr(`✓ ${targets.map(t => t.name).join(', ')} now use${targets.length === 1 ? 's' : ''} ${best.meth.label}.`);
    } catch (e) { setErr(e.message); }
  }

  function start(m) { setMachine(m); setReview(null); setSaved(null); setErr(''); }

  function onResult(r) {
    setScanning(false);
    setReview(r);
    // Pre-fill the truth with the reading most methods agree on (prefer confident ones).
    const tally = {};
    for (const a of r.all) for (const s of a.result?.scores ?? []) {
      const k = `${s.slot}:${s.value}`; tally[k] = (tally[k] || 0) + (a.result.confidence === 'high' ? 2 : 1);
    }
    const bySlot = {};
    for (const [k, w] of Object.entries(tally)) {
      const [slot, value] = k.split(':');
      if (!bySlot[slot] || w > bySlot[slot].w) bySlot[slot] = { value, w };
    }
    setTruth(Object.fromEntries(Object.entries(bySlot).map(([slot, x]) => [slot, x.value])));
  }

  async function save() {
    setBusy(true); setErr('');
    const truthArr = Object.entries(truth).map(([slot, v]) => ({ slot: Number(slot), value: Number(String(v).replace(/\D/g, '')) }))
      .filter(x => x.value > 0).sort((a, b) => a.slot - b.slot);
    const want = scoresKey(truthArr);
    const verdicts = [];
    try {
      for (const a of review.all) {
        const correct = !!a.result && scoresKey(a.result.scores) === want;
        verdicts.push({ method: a.method, correct });
        await host.logScanTest({
          machineId: machine.id, method: a.method, fps: a.fps, conditions: conds.join(', '), truth: truthArr,
          result: { ...(a.result ?? {}), captureMs: a.captureMs, uploadMs: a.uploadMs, sendMs: a.sendMs, uploadKB: a.uploadKB, clipSent: a.clipSent },
          correct, ms: a.captureMs + (a.sendMs || 0),
          photoPath: a.result?.photoPath || photoPaths.get(a.frame) || null,
        });
      }
      await load();
      setSaved(verdicts);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const nextMachine = () => machines.find(m => m.id !== machine?.id && !METHODS.some(x => stats[`${m.id}:${x.key}`]))
    || machines.find(m => m.id !== machine?.id);

  // ---------------- one machine ----------------
  if (machine) {
    const m = machine, tips = captureTips(m);
    const best = bestFor(m);
    const sameType = machines.filter(x => x.display_type === m.display_type);
    return (
      <div className="screen test-page">
        <button className="back linkbtn" onClick={() => setMachine(null)}>← all machines</button>
        <div className="test-head">
          <img src={machineArt(m.name)} alt="" />
          <div><div className="test-machine">{m.name}</div><div className="muted small">1 capture, 3 methods</div></div>
        </div>

        {!review && (
          <>
            <ol className="test-steps">
              <li>Finish a game. Note the real scores (2+ players is best).</li>
              <li><strong>Aim:</strong> {tips.aim}</li>
              {tips.note && <li>{tips.note}</li>}
              <li>Capture: hold still 5 s. Testing takes ~30 s.</li>
            </ol>
            <div className="test-conds">
              {CONDITIONS.map(c => (
                <button key={c} type="button" className={`chip${conds.includes(c) ? ' on' : ''}`}
                  onClick={() => setConds(x => x.includes(c) ? x.filter(y => y !== c) : [...x, c])}>{c}</button>
              ))}
            </div>
            <button className="cta" onClick={() => setScanning(true)}>📸 Capture</button>
          </>
        )}

        {review && (
          <>
            {review.frame && <img className="test-photo" src={review.frame} alt="captured" />}
            <div className="cmp">
              <div className="cmp-row head"><span>Method</span><span>Read</span><span>Sure?</span><span>Time</span></div>
              {review.all.map(a => {
                const v = saved?.find(x => x.method === a.method);
                return (
                  <div key={a.method} className={`cmp-row${v ? (v.correct ? ' good' : ' bad') : ''}`}>
                    <span>{METHODS.find(x => x.key === a.method)?.label}{v ? (v.correct ? ' ✅' : ' ❌') : ''}</span>
                    <span className="mono">{a.result?.scores?.length ? a.result.scores.map(s => `P${s.slot} ${fmt(s.value)}`).join(' · ') : (a.result ? <span className="cmp-note">nothing: {a.result.note || 'no scores seen'}</span> : <span className="cmp-note">failed (no response){a.clipSent ? '' : ' · no clip'}</span>)}</span>
                    <span>{a.result?.confidence === 'high' ? 'yes' : a.result ? 'no' : ''}</span>
                    <span className="mono" title={`capture ${sec(a.captureMs)} + send ${sec(a.uploadMs)} + AI ${sec(a.result?.ms)}`}>{sec(a.captureMs + (a.sendMs || 0))}s</span>
                  </div>
                );
              })}
              <div className="muted small">Time = capture + send + AI.</div>
            </div>

            {!saved ? (
              <div className="card-lite">
                <div className="small"><strong>Real scores</strong> (best guess; fix it):</div>
                <div className="truth-grid">
                  {[1, 2, 3, 4].map(slot => (
                    <label key={slot}>Player {slot}
                      <input inputMode="numeric" value={truth[slot] ?? ''} placeholder="not playing"
                        onChange={e => setTruth(t => ({ ...t, [slot]: e.target.value.replace(/\D/g, '') }))} />
                    </label>
                  ))}
                </div>
                <button className="cta" disabled={busy} onClick={save}>{busy ? 'Saving…' : '✅ Save real scores'}</button>
                <button className="linkbtn small" onClick={() => setReview(null)}>Discard · recapture</button>
              </div>
            ) : (
              <div className="card-lite">
                {best && <div>Best: <strong>{best.meth.label}</strong> ({best.st.ok}/{best.st.n} right, sure {best.st.hi}/{best.st.n}, {sec(best.st.ms / best.st.n)}s)</div>}
                <div className="muted small">Using: {m.scan_mode}</div>
                {best && <button className="secondary" onClick={() => useBest(m)}>Use {best.meth.label}</button>}
                {best && sameType.length > 1 && <button className="secondary" onClick={() => useBest(m, true)}>Use for all {TYPE_LABEL[m.display_type]}</button>}
                <button className="secondary" onClick={() => { setReview(null); setSaved(null); }}>↻ Capture again</button>
                {nextMachine() && <button className="cta" onClick={() => start(nextMachine())}>Next: {nextMachine().name}</button>}
              </div>
            )}
          </>
        )}

        {err && <div className={err.startsWith('✓') ? 'ok' : 'err'}>{err}</div>}
        {scanning && createPortal(
          <Scanner
            testMode={{ all: true, machineId: m.id }}
            onResult={onResult}
            onCancel={() => setScanning(false)}
            onFallback={() => { setScanning(false); setErr('No camera here.'); }}
            onDone={() => setScanning(false)}
          />,
          document.body,
        )}
      </div>
    );
  }

  // ---------------- overview ----------------
  return (
    <div className="screen test-page">
      <Link className="back" to="/host">← Host</Link>
      <h1>Calibrate</h1>
      <p className="muted small">1 capture per machine tests 3 methods. Then apply the best.</p>
      {err && <div className={err.startsWith('✓') ? 'ok' : 'err'}>{err}</div>}
      {nextMachine() && <button className="cta" onClick={() => start(nextMachine())}>Calibrate {nextMachine().name}</button>}
      <details className="card-lite tips-card"><summary><strong>Capture tips</strong></summary><ul>{GENERAL_TIPS.map(t => <li key={t}>{t}</li>)}</ul></details>

      <div className="cal-list">
        {machines.map(m => {
          const best = bestFor(m);
          return (
            <div key={m.id} className="cal-row">
              <div className="cal-name">
                <strong>{m.name}</strong>
                <span className="muted small">using {m.scan_mode}{best && best.meth.mode !== m.scan_mode ? ` · best: ${best.meth.label}` : ''}</span>
              </div>
              <div className="cal-cells">
                {METHODS.map(x => {
                  const st = stats[`${m.id}:${x.key}`];
                  const cls = !st ? '' : st.ok === st.n ? ' good' : st.ok === 0 ? ' bad' : ' mixed';
                  return <span key={x.key} className={`cal-cell${cls}`} title={x.label}>{x.label}<br />{st ? `${st.ok}/${st.n} · ${sec(st.ms / st.n)}s` : '—'}</span>;
                })}
              </div>
              <div className="row gap">
                <button className="ghost" onClick={() => start(m)}>▶ Test</button>
                {best && best.meth.mode !== m.scan_mode && <button className="ghost" onClick={() => useBest(m)}>Use {best.meth.label}</button>}
              </div>
            </div>
          );
        })}
      </div>

      <details className="card-lite">
        <summary><strong>All captures ({tests.length})</strong></summary>
        {[...tests].reverse().slice(0, 40).map(t => (
          <div key={t.id} className="tr-row small">
            <span>{machines.find(m => m.id === t.machine_id)?.name} · {methodKey(t)}{t.conditions ? ` · ${t.conditions}` : ''}</span>
            <span>{t.correct ? '✅' : '❌'} {sec(t.ms)}s {t.photo_path && <a className="link" href={photoUrl(t.photo_path)} target="_blank" rel="noreferrer">photo</a>}</span>
          </div>
        ))}
      </details>
    </div>
  );
}
