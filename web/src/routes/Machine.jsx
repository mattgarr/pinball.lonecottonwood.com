import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { actions, useStandings } from '../lib/store.js';
import { machineArt } from '../lib/machineArt.js';
import { fmt, fmtShort, ordinal } from '../lib/scoring.js';
import { checkScore, crownInfo, sayNumber } from '../lib/plausibility.js';
import { readScores } from '../lib/scoreReader.js';
import { afterSheetClose } from '../lib/useBackClose.js';
import Avatar from '../components/Avatar.jsx';
import Confetti from '../components/Confetti.jsx';
import LedNumber from '../components/LedNumber.jsx';
import ScorePad from '../components/ScorePad.jsx';
import PhotoButton from '../components/PhotoButton.jsx';
import PlayerPicker from '../components/PlayerPicker.jsx';
import Sheet from '../components/Sheet.jsx';

const UNDO_MS = 15 * 60 * 1000;

// Steps live in history state (location.state.step), so the phone's Back button walks
// back through the flow (confirm → keypad → start) instead of dumping you on Home.
//   start   → big art, "📸 Snap the score" / "or type it"
//   reading → photo being read
//   pad     → keypad (single score, me)
//   confirm → big DMD number + machine, plausibility + crown checks, Submit / Fix it
//   assign  → "Who was who?" (multi-score photo) or "Log your friends' scores"
//   done    → results; undo; next suggestion; log friends
export default function Machine() {
  const { id } = useParams();
  const mid = Number(id);
  const { machines, players, scores, me, standings, party, ready } = useStandings();
  const loc = useLocation();
  const nav = useNavigate();

  const [photo, setPhoto] = useState(null);       // JPEG data URL of the score display
  const [readInfo, setReadInfo] = useState(null);  // { confidence, note, failed }
  const [pad, setPad] = useState('');              // keypad digits for my single score
  const [rows, setRows] = useState([]);            // group rows (assign step)
  const [groupMode, setGroupMode] = useState('photo'); // 'photo' | 'friends'
  const [results, setResults] = useState([]);      // what got logged (done step)
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [err, setErr] = useState('');
  const [switcher, setSwitcher] = useState(false);
  const [viewPhoto, setViewPhoto] = useState(false);

  const rawStep = loc.state?.step || 'start';
  const stepRef = useRef(rawStep);
  stepRef.current = rawStep;

  // A fresh visit (e.g. tapping "Next: Fathom") starts clean; the wrong-machine switcher keeps data.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (loc.state?.keep) return;
    setPhoto(null); setReadInfo(null); setPad(''); setRows([]); setResults([]); setNotice(''); setErr('');
  }, [mid]); // eslint-disable-line react-hooks/exhaustive-deps

  const machine = machines.find(m => m.id === mid);
  const machineScores = useMemo(() => scores.filter(s => s.machine_id === mid && !s.voided), [scores, mid]);

  if (!ready) return <Loading />;
  if (!me) return null; // App redirects to /join
  if (!machine) {
    return (
      <div className="screen">
        <Link className="back-link" to="/">‹ All machines</Link>
        <div className="err">That machine isn't in tonight's lineup.</div>
      </div>
    );
  }

  const board = standings.machines.find(x => x.machine.id === mid);
  const myStats = standings.stats.get(me.id);
  const mineHere = myStats?.perMachine[mid] ?? null;
  const closed = party?.status === 'closed';
  const playerById = new Map(players.map(p => [p.id, p]));

  // Guard steps that need data we no longer have (reload, or Back after a reset).
  let step = rawStep;
  if (step === 'reading' && !photo) step = 'start';
  if (step === 'confirm' && !pad) step = 'pad';
  if (step === 'assign' && rows.length === 0 && groupMode === 'photo') step = 'start';
  if (step === 'done' && results.length === 0) step = 'start';
  if (closed && step !== 'done') step = 'start';

  const goStep = (s, { replace = false } = {}) =>
    nav(loc.pathname, { replace, state: { step: s, from: step } });

  function snapshotFor(pid, value) {
    const prev = standings.stats.get(pid)?.perMachine[mid] ?? null;
    const rowsHere = board?.rows ?? [];
    const champ = rowsHere[0];
    const dethroned = champ && champ.playerId !== pid && value > champ.best ? playerById.get(champ.playerId) ?? null : null;
    const passed = rowsHere.filter(r => r.playerId !== pid && r.best < value && (prev == null || r.best > prev.best)).length;
    return { prevRank: prev?.rank ?? null, prevBest: prev?.best ?? null, prevN: prev?.N ?? null, dethroned, passed };
  }

  function lock() {
    if (busyRef.current) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErr("You're offline, so nothing was sent. Your number is still here — tap again once you're back on Wi-Fi.");
      return false;
    }
    busyRef.current = true; setBusy(true); setErr('');
    return true;
  }
  function unlock() { busyRef.current = false; setBusy(false); }

  // ---------- photo ----------
  async function onSnap(dataUrl) {
    setPhoto(dataUrl); setErr(''); setNotice(''); setReadInfo(null);
    goStep('reading');
    stepRef.current = 'reading'; // the read can resolve instantly (scanner cache) before the re-render
    const r = await readScores(dataUrl, machine);
    if (stepRef.current !== 'reading') return; // they backed out while it was reading
    if (!r) {
      setReadInfo({ failed: true });
      setPad('');
      goStep('pad', { replace: true });
      return;
    }
    setReadInfo({ confidence: r.confidence, note: r.note });
    if (r.scores.length === 1) {
      const v = r.scores[0].value;
      setPad(v ? String(v) : '');
      goStep(v ? 'confirm' : 'pad', { replace: true });
      return;
    }
    setGroupMode('photo');
    setRows(r.scores.map((s, i) => ({ key: `s${s.slot}-${i}`, slot: s.slot, value: s.value, who: i === 0 ? 'me' : undefined })));
    goStep('assign', { replace: true });
  }

  // ---------- my single score ----------
  async function submitSolo() {
    const value = Number(pad);
    if (!value || !lock()) return;
    const snap = snapshotFor(me.id, value);
    const { claimedTop } = crownInfo(value, me.id, machineScores);
    try {
      const r = await actions.submitScore(mid, value, { photo, claimedTop });
      setResults([{ key: `me${r.score_id}`, who: 'me', playerId: me.id, value, scoreId: r.score_id, duplicate: !!r.duplicate, at: Date.now(), ...snap }]);
      setPad('');
      goStep('done', { replace: true });
    } catch (e) {
      setErr(friendlyError(e, false));
    } finally { unlock(); }
  }

  // ---------- several scores (photo "who was who" or friends) ----------
  async function submitGroup() {
    const todo = rows.filter(r => r.who != null && r.value > 0 && !r.ok);
    if (!todo.length || !lock()) return;
    const out = [];
    const rowPatch = {};
    for (const r of todo) {
      const pid = r.who === 'me' ? me.id : r.who;
      const snap = snapshotFor(pid, r.value);
      const { claimedTop } = crownInfo(r.value, pid, machineScores);
      try {
        const res = r.who === 'me'
          ? await actions.submitScore(mid, r.value, { photo, claimedTop })
          : await actions.submitScoreFor(pid, mid, r.value, { photo, claimedTop });
        out.push({ key: `${pid}-${res.score_id}`, who: r.who === 'me' ? 'me' : 'friend', playerId: pid, value: r.value, scoreId: res.score_id, duplicate: !!res.duplicate, at: Date.now(), ...snap });
        rowPatch[r.key] = { ok: true, error: null };
      } catch (e) {
        const msg = friendlyError(e, r.who !== 'me');
        out.push({ key: `${pid}-err-${r.key}`, who: r.who === 'me' ? 'me' : 'friend', playerId: pid, value: r.value, error: msg, ...snap });
        rowPatch[r.key] = { ok: false, error: msg };
      }
    }
    unlock();
    setRows(rs => rs.map(r => (rowPatch[r.key] ? { ...r, ...rowPatch[r.key] } : r)));
    const anyOk = out.some(x => !x.error);
    if (!anyOk) { setErr(out[0]?.error || 'Nothing was logged. Try again.'); return; }
    setResults(prev => [...prev.filter(p => !out.some(o => o.playerId === p.playerId && p.error)), ...out]);
    goStep('done', { replace: true });
  }

  async function retryFriend(res) {
    if (!lock()) return;
    try {
      const { claimedTop } = crownInfo(res.value, res.playerId, machineScores);
      const r = await actions.submitScoreFor(res.playerId, mid, res.value, { photo, claimedTop });
      setResults(list => list.map(x => (x.key === res.key ? { ...x, error: null, scoreId: r.score_id, duplicate: !!r.duplicate, at: Date.now() } : x)));
    } catch (e) {
      setResults(list => list.map(x => (x.key === res.key ? { ...x, error: friendlyError(e, true) } : x)));
    } finally { unlock(); }
  }

  async function undoMine(res) {
    if (!lock()) return;
    try {
      await actions.undoScore(res.scoreId);
      setResults(list => list.filter(x => x.key !== res.key));
      setPad(String(res.value));
      setNotice(`Removed ${fmt(res.value)}. Fix the number and submit again.`);
      goStep('pad', { replace: true });
    } catch (e) {
      setErr(friendlyError(e, false));
    } finally { unlock(); }
  }

  function startFriends() {
    setGroupMode('friends');
    setErr('');
    setRows([{ key: `f${Date.now()}`, slot: null, value: null, who: undefined, autoPick: true }]);
    goStep('assign');
  }

  function logAnother() {
    setPhoto(null); setReadInfo(null); setPad(''); setRows([]); setResults([]); setNotice(''); setErr('');
    goStep('start', { replace: true });
  }

  function switchTo(m) {
    setSwitcher(false);
    afterSheetClose(() => nav(`/machine/${m.id}`, { replace: true, state: { ...(loc.state || {}), keep: true } }));
  }

  const myLoggedHere = results.some(r => r.who === 'me' && !r.error);

  return (
    <div className={`screen machine-flow step-${step}`}>
      {step === 'start' && (
        <StartStep
          machine={machine} mineHere={mineHere} board={board} closed={closed}
          onSwitch={() => setSwitcher(true)} onSnap={onSnap} onType={() => { setPhoto(null); setReadInfo(null); setNotice(''); goStep('pad'); }}
          onPhotoError={setErr} me={me}
        />
      )}

      {step === 'reading' && <MachineStrip machine={machine} onSwitch={() => setSwitcher(true)} />}
      {step === 'reading' && <ReadingStep machine={machine} photo={photo} onCancel={() => { setReadInfo({ failed: true }); goStep('pad', { replace: true }); }} />}

      {step === 'pad' && (
        <>
          <MachineStrip machine={machine} onSwitch={() => setSwitcher(true)} />
          {notice && <div className="note-ok">{notice}</div>}
          {photo && (
            <button type="button" className="photo-strip" onClick={() => setViewPhoto(true)}>
              <img src={photo} alt="your photo of the score" />
              <span className="photo-strip-label">{readInfo?.failed ? "Couldn't read it automatically. Type what you see 👀" : 'Your photo · tap to zoom'}</span>
            </button>
          )}
          <ScorePad value={pad} onChange={setPad} />
          <div className="actionbar">
            {!photo && (
              <PhotoButton className="ghost-btn" onPhoto={onSnap} onError={setErr}>📸 Snap it instead</PhotoButton>
            )}
            <button type="button" className="cta" disabled={!pad} onClick={() => goStep('confirm')}>
              Next
            </button>
          </div>
        </>
      )}

      {step === 'confirm' && (
        <ConfirmStep
          machine={machine} value={Number(pad)} photo={photo} readInfo={readInfo} me={me}
          machineScores={machineScores} busy={busy}
          onAttach={setPhoto} onPhotoError={setErr}
          onFix={() => (loc.state?.from === 'pad' ? nav(-1) : goStep('pad', { replace: true }))}
          onSubmit={submitSolo} onSwitch={() => setSwitcher(true)}
        />
      )}

      {step === 'assign' && (
        <AssignStep
          mode={groupMode} machine={machine} rows={rows} setRows={setRows} photo={photo} readInfo={readInfo}
          me={me} players={players} scores={scores} machineScores={machineScores}
          allowMe={groupMode === 'photo' || !myLoggedHere}
          myLoggedValue={results.find(r => r.who === 'me' && !r.error)?.value}
          busy={busy} onSubmit={submitGroup} onSwitch={() => setSwitcher(true)}
          onViewPhoto={() => setViewPhoto(true)} onAttach={setPhoto} onPhotoError={setErr}
          onReadMore={async dataUrl => {
            setPhoto(dataUrl);
            const r = await readScores(dataUrl, machine);
            return r;
          }}
        />
      )}

      {step === 'done' && (
        <DoneStep
          machine={machine} machines={machines} results={results} standings={standings} me={me}
          playerById={playerById} busy={busy}
          onUndo={undoMine} onRetry={retryFriend} onFriends={startFriends} onAnother={logAnother}
        />
      )}

      {err && <div className="err" role="alert">{err}</div>}

      {(step === 'start' || step === 'done') && <TopScores board={board} me={me} mineHere={mineHere} mid={mid} />}

      <Sheet open={switcher} onClose={() => setSwitcher(false)} title="Which machine are you on?">
        <div className="switch-list">
          {machines.map(m => (
            <button key={m.id} type="button" className={`switch-row${m.id === mid ? ' on' : ''}`} onClick={() => switchTo(m)}>
              <img src={machineArt(m.name)} alt="" />
              <span className="switch-name">{m.name}<span className="switch-meta">{m.manufacturer} · {m.year}</span></span>
              {m.id === mid && <span className="switch-here">this one</span>}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={viewPhoto && !!photo} onClose={() => setViewPhoto(false)} title="Your photo" tall>
        {photo && <img className="photo-full" src={photo} alt="your photo of the score display" />}
      </Sheet>
    </div>
  );
}

function friendlyError(e, forFriend) {
  const m = String(e?.message || e || '');
  if (/does not exist|could not find the function|schema cache/i.test(m)) {
    return forFriend
      ? "Logging scores for friends isn't switched on yet. They can log it on their own phone, or the host can add it."
      : 'The scoreboard is being updated. Try again in a minute.';
  }
  if (/failed to fetch|network|load failed|timeout/i.test(m)) return "Couldn't reach the scoreboard, so it wasn't saved. Check Wi-Fi and tap again.";
  if (/join|rejoin/i.test(m)) return 'This phone got signed out. Tap your name (top right) or Rejoin, then try again.';
  return m || 'Something went wrong. Try again.';
}

function Loading() {
  return <div className="screen center"><div className="spinner" aria-label="Loading" /></div>;
}

// ---------------------------------------------------------------------------
function StartStep({ machine, mineHere, closed, onSwitch, onSnap, onType, onPhotoError }) {
  return (
    <>
      <div className="mhero">
        <img className="mhero-img" src={machineArt(machine.name)} alt={`${machine.name} backglass`} />
        <div className="mhero-shade" />
        <Link to="/" className="mhero-back" aria-label="All machines">‹</Link>
        <button type="button" className="mhero-switch" onClick={onSwitch}>Wrong machine?</button>
        <div className="mhero-text">
          <div className="mhero-name">{machine.name}</div>
          <div className="mhero-meta">
            {machine.manufacturer} · {machine.year}
            {mineHere
              ? <span className={`rank-pill${mineHere.rank === 1 ? ' gold' : ''}`}>{mineHere.rank === 1 ? '👑 ' : ''}{ordinal(mineHere.rank)} of {mineHere.N}</span>
              : <span className="rank-pill new">not played yet</span>}
          </div>
        </div>
      </div>

      {closed ? (
        <div className="err">Scoring is closed for the night. Final standings are on the TV.</div>
      ) : (
        <div className="start-actions">
          <PhotoButton className="snap-btn" onPhoto={onSnap} onError={onPhotoError}>
            <span className="snap-icon" aria-hidden="true">📸</span>
            <span className="snap-text">
              <span className="snap-title">Snap the score</span>
              <span className="snap-sub">Point at the display. It reads everyone's scores</span>
            </span>
          </PhotoButton>
          <button type="button" className="type-btn" onClick={onType}>or type it in ⌨️</button>
          {mineHere && <div className="muted small center-text">Your best here: <span className="mono amber">{fmt(mineHere.best)}</span></div>}
        </div>
      )}
      <Link to={`/machine/${machine.id}/guide`} className="guide-chip">📖 How to play {machine.name}</Link>
    </>
  );
}

function ReadingStep({ machine, photo, onCancel }) {
  return (
    <div className="reading-card">
      <div className="reading-photo">
        <img src={photo} alt="" />
        <div className="reading-scan" aria-hidden="true" />
      </div>
      <LedNumber value="" placeholder="READING…" size="md" className="led-reading" label="Reading the photo" />
      <div className="muted small center-text">Reading the {machine.name} display…</div>
      <button type="button" className="type-btn" onClick={onCancel}>Skip, I'll type it</button>
    </div>
  );
}

function MachineStrip({ machine, onSwitch }) {
  return (
    <div className="mstrip">
      <img src={machineArt(machine.name)} alt="" />
      <div className="mstrip-shade" />
      <div className="mstrip-text">
        <div className="mstrip-label">Logging on</div>
        <div className="mstrip-name">{machine.name}</div>
      </div>
      <button type="button" className="mstrip-switch" onClick={onSwitch}>Wrong machine?</button>
    </div>
  );
}

// Warnings + crown checks shared by the single-score confirm and the group screen.
function preflight(value, pid, machine, machineScores, photo) {
  const warnings = checkScore(value, machine, machineScores);
  const crown = crownInfo(value, pid, machineScores);
  return { warnings, crown, needsPhoto: crown.contested && !photo };
}

function ConfirmStep({ machine, value, photo, readInfo, me, machineScores, busy, onAttach, onPhotoError, onFix, onSubmit, onSwitch }) {
  const { warnings, crown, needsPhoto } = preflight(value, me.id, machine, machineScores, photo);
  const fromPhoto = !!photo && readInfo && !readInfo.failed;
  return (
    <>
      <div className="confirm-card">
        <div className="confirm-art">
          <img src={machineArt(machine.name)} alt="" />
          <div className="confirm-art-shade" />
          <div className="confirm-machine">{machine.name}</div>
          <button type="button" className="mstrip-switch" onClick={onSwitch}>Wrong machine?</button>
        </div>
        <div className="confirm-body">
          <div className="confirm-label">{fromPhoto ? 'We read' : 'You typed'}</div>
          <LedNumber value={value} size="xl" />
          <div className="confirm-say">≈ {sayNumber(value)}</div>
          {fromPhoto && readInfo.confidence !== 'high' && <div className="hint">Blurry photo. Check it against the machine.</div>}
          {fromPhoto && readInfo.note && <div className="muted small center-text">{readInfo.note}</div>}
        </div>
      </div>

      {warnings.map(w => (
        <div key={w.kind} className="warn-card">
          <div className="warn-title">🤔 {w.title}</div>
          <div className="warn-detail">{w.detail}</div>
        </div>
      ))}

      {crown.claimedTop && (
        <div className={`crown-card${needsPhoto ? ' needs' : ''}`}>
          <div className="crown-title">👑 {crown.contested ? `That beats tonight's best (${fmt(crown.othersBest)})` : 'First score on this machine!'}</div>
          {needsPhoto ? (
            <>
              <div className="crown-detail">Crown claims need a photo 📸 so the host can confirm it.</div>
              <PhotoButton className="snap-btn small" onPhoto={onAttach} onError={onPhotoError}>
                <span className="snap-icon" aria-hidden="true">📸</span>
                <span className="snap-title">Add a photo of the display</span>
              </PhotoButton>
            </>
          ) : photo ? (
            <div className="crown-detail">📸 Photo attached. Nice.</div>
          ) : null}
        </div>
      )}

      <div className="actionbar two">
        <button type="button" className="ghost-btn" onClick={onFix} disabled={busy}>✏️ Fix it</button>
        <button type="button" className={`cta${needsPhoto ? ' cta-soft' : ''}`} onClick={onSubmit} disabled={busy}>
          {busy ? 'Saving…' : needsPhoto ? 'Submit without photo' : warnings.length ? "Yes, it's right" : 'Submit ✓'}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function AssignStep({ mode, machine, rows, setRows, photo, readInfo, me, players, scores, machineScores, allowMe, myLoggedValue,
  busy, onSubmit, onSwitch, onViewPhoto, onAttach, onPhotoError, onReadMore }) {
  const [pickFor, setPickFor] = useState(null);   // row key
  const [editFor, setEditFor] = useState(null);   // row key
  const [editVal, setEditVal] = useState('');
  const [checkOpen, setCheckOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);

  // A freshly-added friend row opens the picker straight away.
  useEffect(() => {
    const r = rows.find(x => x.autoPick);
    if (r) {
      setRows(rs => rs.map(x => (x.key === r.key ? { ...x, autoPick: false } : x)));
      setPickFor(r.key);
    }
  }, [rows, setRows]);

  const assignedIds = new Set(rows.filter(r => r.who != null && r.who !== 'me').map(r => r.who));
  const pid = r => (r.who === 'me' ? me.id : r.who);
  const readyRows = rows.filter(r => r.who != null && r.value > 0 && !r.ok);
  const unresolved = rows.filter(r => !r.ok && (r.who === undefined || (r.who !== null && !(r.value > 0))));
  const checks = readyRows.map(r => ({ r, ...preflight(r.value, pid(r), machine, machineScores, photo) }));
  const flagged = checks.filter(c => c.warnings.length || c.needsPhoto);

  function pick(key, who) {
    const editAfter = rows.find(r => r.key === key && !(r.value > 0)) && who !== null;
    setRows(rs => rs.map(r => {
      if (r.key === key) return { ...r, who, error: null };
      if (who != null && r.who === who) return { ...r, who: undefined }; // someone can only be one slot
      return r;
    }));
    setPickFor(null);
    if (editAfter) afterSheetClose(() => { setEditVal(''); setEditFor(key); });
  }
  function openEdit(r) { setEditVal(r.value ? String(r.value) : ''); setEditFor(r.key); }
  function saveEdit() {
    const v = Number(editVal) || null;
    setRows(rs => rs.map(r => (r.key === editFor ? { ...r, value: v, error: null } : r)));
    setEditFor(null);
  }
  function addRow() {
    const key = `f${Date.now()}`;
    setRows(rs => [...rs, { key, slot: null, value: null, who: undefined }]);
    setPickFor(key);
  }
  async function snapMore(dataUrl) {
    setReading(true);
    const r = await onReadMore(dataUrl);
    setReading(false);
    if (!r) { onPhotoError("Couldn't read that photo. Add friends' scores by hand below."); return; }
    const fresh = r.scores.filter(s => s.value !== myLoggedValue);
    setRows(rs => [...rs.filter(x => x.ok || x.who != null || x.value), ...fresh.map((s, i) => ({ key: `p${Date.now()}-${i}`, slot: s.slot, value: s.value, who: undefined }))]);
  }

  const editRow = rows.find(r => r.key === editFor);
  const editWho = editRow?.who === 'me' ? me : editRow?.who != null ? playerById.get(editRow.who) : null;
  const editTitle = editRow?.value ? 'Fix the score' : editWho ? `${editWho.display_name}'s score` : 'Enter the score';

  const submitClick = () => (flagged.length ? setCheckOpen(true) : onSubmit());

  return (
    <>
      <MachineStrip machine={machine} onSwitch={onSwitch} />
      <div className="assign-head">
        <h1>{mode === 'photo' ? 'Who was who?' : "Log your friends' scores"}</h1>
        <div className="muted small">
          {mode === 'photo'
            ? `We read ${rows.length} score${rows.length === 1 ? '' : 's'}. Tap a name to assign it, tap a number to fix it.`
            : 'Pick who played with you, then their score. It shows up on their phone too.'}
        </div>
      </div>

      {photo && (
        <button type="button" className="photo-strip" onClick={onViewPhoto}>
          <img src={photo} alt="your photo of the score" />
          <span className="photo-strip-label">
            {readInfo?.confidence === 'low' ? '⚠️ Blurry in places. Check each number · tap to zoom' : 'Your photo · tap to zoom'}
          </span>
        </button>
      )}
      {readInfo?.note && <div className="muted small">{readInfo.note}</div>}

      <div className="assign-list">
        {rows.map((r, i) => {
          const p = r.who === 'me' ? me : r.who != null ? playerById.get(r.who) : null;
          const c = r.who != null && r.value > 0 ? preflight(r.value, pid(r), machine, machineScores, photo) : null;
          return (
            <div key={r.key} className={`assign-row${r.who === null ? ' skipped' : ''}${r.ok ? ' done' : ''}`}>
              <div className="assign-top">
                <span className="slot-label">{r.slot ? `PLAYER ${r.slot}` : `FRIEND ${i + 1}`}</span>
                {r.ok && <span className="ok-pill">✓ logged</span>}
                {mode === 'friends' && !r.ok && (
                  <button type="button" className="row-x" aria-label="Remove" onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>✕</button>
                )}
              </div>
              <LedNumber
                value={r.value || ''} size="md" placeholder="TAP TO ENTER"
                onClick={r.ok || r.who === null ? undefined : () => openEdit(r)}
                label={r.value ? `Player ${r.slot ?? i + 1} score ${fmt(r.value)}, tap to fix` : 'Enter score'}
              />
              <button type="button" className={`assignee${p ? '' : ' empty'}`} disabled={r.ok} onClick={() => setPickFor(r.key)}>
                {r.who === null ? (
                  <><span className="assignee-skip">⤼</span><span>Skipped · tap to assign</span></>
                ) : p ? (
                  <><Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={30} />
                    <span className="assignee-name">{r.who === 'me' ? `${p.display_name} (me)` : p.display_name}</span>
                    {!r.ok && <span className="assignee-change">change</span>}</>
                ) : (
                  <><span className="assignee-plus">＋</span><span>Pick player</span></>
                )}
              </button>
              {c?.warnings.map(w => <div key={w.kind} className="row-warn">🤔 <strong>{w.title}</strong> {w.detail}</div>)}
              {c?.crown.claimedTop && <div className="row-crown">👑 {c.crown.contested ? 'New record!' : 'First on the board'}{c.needsPhoto ? ' A photo makes it official.' : ''}</div>}
              {r.error && <div className="row-err">{r.error}</div>}
            </div>
          );
        })}
      </div>

      <div className="assign-tools">
        <button type="button" className="ghost-btn" onClick={addRow}>＋ Add a player</button>
        {mode === 'friends' && !photo && (
          <PhotoButton className="ghost-btn" onPhoto={snapMore} onError={onPhotoError} disabled={reading}>
            {reading ? 'Reading…' : '📸 Snap the display'}
          </PhotoButton>
        )}
      </div>

      <div className="actionbar">
        {unresolved.length > 0 && readyRows.length > 0 && (
          <div className="actionbar-hint">{unresolved.length} score{unresolved.length === 1 ? '' : 's'} not assigned yet. They'll be skipped.</div>
        )}
        <button type="button" className="cta" disabled={busy || readyRows.length === 0} onClick={submitClick}>
          {busy ? 'Saving…' : readyRows.length ? `Log ${readyRows.length} score${readyRows.length === 1 ? '' : 's'}` : 'Pick who scored'}
        </button>
      </div>

      <Sheet open={pickFor != null} onClose={() => setPickFor(null)} title="Who got this score?" tall>
        <PlayerPicker
          players={players} scores={scores} me={me} machineId={machine.id}
          exclude={new Set([...assignedIds].filter(x => x !== rows.find(r => r.key === pickFor)?.who))}
          allowMe={allowMe} allowSkip={mode === 'photo'}
          onPick={who => pick(pickFor, who)}
        />
      </Sheet>

      <Sheet open={editFor != null} onClose={() => setEditFor(null)} title={editTitle} tall>
        {photo && <img className="photo-mini" src={photo} alt="" />}
        <ScorePad value={editVal} onChange={setEditVal} />
        <div className="sheet-actions">
          <button type="button" className="cta" disabled={!editVal} onClick={saveEdit}>Done</button>
        </div>
      </Sheet>

      <Sheet open={checkOpen} onClose={() => setCheckOpen(false)} title="Quick double-check">
        <div className="check-list">
          {flagged.map(({ r, warnings, needsPhoto }) => {
            const p = r.who === 'me' ? me : playerById.get(r.who);
            return (
              <div key={r.key} className="check-item">
                <div className="check-who">{p?.display_name}: <span className="mono amber">{fmt(r.value)}</span></div>
                {warnings.map(w => <div key={w.kind} className="warn-detail">🤔 <strong>{w.title}</strong> {w.detail}</div>)}
                {needsPhoto && <div className="warn-detail">👑 Crown claims need a photo 📸</div>}
              </div>
            );
          })}
          {flagged.some(f => f.needsPhoto) && (
            <PhotoButton className="snap-btn small" onPhoto={d => onAttach(d)} onError={onPhotoError}>
              <span className="snap-icon" aria-hidden="true">📸</span><span className="snap-title">Add a photo of the display</span>
            </PhotoButton>
          )}
        </div>
        <div className="sheet-actions two">
          <button type="button" className="ghost-btn" onClick={() => setCheckOpen(false)}>✏️ Fix it</button>
          <button type="button" className="cta" disabled={busy} onClick={() => { setCheckOpen(false); afterSheetClose(onSubmit); }}>Yes, log them</button>
        </div>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
function DoneStep({ machine, machines, results, standings, me, playerById, busy, onUndo, onRetry, onFriends, onAnother }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 15000); return () => clearInterval(t); }, []);

  const mine = results.find(r => r.who === 'me' && !r.error);
  const friends = results.filter(r => r.who !== 'me' || r.error);
  const myStats = standings.stats.get(me.id);
  const now = myStats?.perMachine[machine.id] ?? null;
  const tookCrown = mine && now?.rank === 1 && mine.prevRank !== 1 && !mine.duplicate;
  const isPB = mine && (mine.prevBest == null || mine.value > mine.prevBest);
  const climbed = mine && mine.prevRank != null && now && now.rank < mine.prevRank;
  const undoLeft = mine ? Math.max(0, UNDO_MS - (Date.now() - mine.at)) : 0;

  const title = !mine ? `Logged ${friends.filter(f => !f.error).length} for your friends 🎉`
    : mine.duplicate ? 'Already got that one 👍'
    : tookCrown ? 'You took the crown!'
    : isPB && mine.prevBest != null ? 'New personal best!'
    : 'Score logged!';

  const next = nextSuggestion(machines, myStats, machine.id);

  return (
    <>
      <div className={`done-card${tookCrown ? ' crowned' : ''}`}>
        {tookCrown && <Confetti count={110} />}
        {tookCrown && <div className="done-crown" aria-hidden="true">👑</div>}
        <div className="done-machine">{machine.name}</div>
        <h1 className="done-title">{title}</h1>
        {mine && <LedNumber value={mine.value} size="xl" />}
        {mine && now && (
          <div className="done-stats">
            <div className="done-rank">
              <span className="done-rank-num">{ordinal(now.rank)}</span>
              <span className="done-rank-of">of {now.N}</span>
            </div>
            <div className="done-lines">
              {mine.prevRank == null
                ? <span className="move new">NEW on the board</span>
                : climbed ? <span className="move up">▲ up from {ordinal(mine.prevRank)}</span>
                : <span className="move flat">held {ordinal(now.rank)}</span>}
              {isPB && mine.prevBest != null && <span className="move pb">★ personal best</span>}
              {!isPB && <span className="done-sub">Your best ({fmt(now.best)}) still counts.</span>}
              {mine.dethroned && <span className="done-sub">You knocked <strong>{mine.dethroned.display_name}</strong> off the top.</span>}
              {!mine.dethroned && mine.passed > 0 && mine.prevRank != null && <span className="done-sub">Passed {mine.passed} player{mine.passed === 1 ? '' : 's'}.</span>}
            </div>
          </div>
        )}
        {mine && !mine.duplicate && undoLeft > 0 && (
          <button type="button" className="undo-btn" disabled={busy} onClick={() => onUndo(mine)}>
            ↶ Typo? Undo <span className="undo-time">({Math.ceil(undoLeft / 60000)} min left)</span>
          </button>
        )}
      </div>

      {friends.length > 0 && (
        <section className="panel">
          <h3>Also logged</h3>
          <ul className="friend-results">
            {friends.map(f => {
              const p = playerById.get(f.playerId);
              const st = standings.stats.get(f.playerId)?.perMachine[machine.id];
              return (
                <li key={f.key} className={f.error ? 'failed' : ''}>
                  <Avatar avatar={p?.avatar} emoji={p?.emoji} name={p?.display_name} color={p?.color} size={32} />
                  <span className="fr-name">{p?.display_name ?? 'Player'}</span>
                  <span className="fr-val mono amber">{fmtShort(f.value)}</span>
                  <span className="fr-rank">{f.error ? '' : st ? `${st.rank === 1 ? '👑' : ordinal(st.rank)}` : '…'}</span>
                  {f.error && (
                    <div className="fr-err">
                      {f.error}
                      {f.who !== 'me' && <button type="button" className="ghost-btn tiny" disabled={busy} onClick={() => onRetry(f)}>Try again</button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="muted small">Wrong number for a friend? They can undo it on their phone, or ask the host.</div>
        </section>
      )}

      <button type="button" className="friends-btn" onClick={onFriends}>
        <span aria-hidden="true">👯</span> {friends.length ? 'Log more friends' : 'Played with friends? Log theirs too'}
      </button>

      {next && (
        <Link to={`/machine/${next.machine.id}`} className="next-card">
          <img src={machineArt(next.machine.name)} alt="" />
          <div className="next-text">
            <div className="next-label">Up next</div>
            <div className="next-line">{next.line}</div>
          </div>
          <span className="next-go">›</span>
        </Link>
      )}

      <div className="actionbar two">
        <Link to="/" className="ghost-btn">All machines</Link>
        <button type="button" className="cta" onClick={onAnother}>Log another game</button>
      </div>
    </>
  );
}

function nextSuggestion(machines, st, currentId) {
  if (!st) return null;
  const others = machines.filter(m => m.id !== currentId);
  const unplayed = others.find(m => !st.perMachine[m.id]);
  if (unplayed) {
    const left = machines.filter(m => !st.perMachine[m.id]).length;
    return { machine: unplayed, line: `You haven't played ${unplayed.name} yet${left > 1 ? ` (${left} to go)` : ''}` };
  }
  const worst = others
    .map(m => ({ m, pm: st.perMachine[m.id] }))
    .filter(x => x.pm && x.pm.rank > 1)
    .sort((a, b) => a.pm.standing - b.pm.standing)[0];
  if (worst) return { machine: worst.m, line: `You're ${ordinal(worst.pm.rank)} on ${worst.m.name}. Go climb.` };
  return null;
}

function TopScores({ board, me, mineHere }) {
  return (
    <section className="panel top-scores">
      <div className="panel-head">
        <h3>Tonight's top scores</h3>
        {mineHere && <span className="muted small">You: {ordinal(mineHere.rank)} of {mineHere.N}</span>}
      </div>
      {(!board || board.top.length === 0) && <div className="muted small">No scores yet. Be the first! 👑</div>}
      <ol className="ts-list">
        {board?.top.map(s => (
          <li key={s.player.id} className={s.player.id === me?.id ? 'mine' : ''}>
            <span className="ts-rank">{s.rank === 1 ? '👑' : s.rank}</span>
            <Avatar avatar={s.player.avatar} emoji={s.player.emoji} name={s.player.display_name} color={s.player.color} size={28} />
            <span className="ts-name">{s.player.display_name}</span>
            <span className="ts-val">{fmt(s.score)}</span>
          </li>
        ))}
      </ol>
      {mineHere && mineHere.rank > 10 && (
        <div className="muted small">Your best: <span className="mono">{fmt(mineHere.best)}</span> ({ordinal(mineHere.rank)})</div>
      )}
    </section>
  );
}
