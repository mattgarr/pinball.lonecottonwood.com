import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { actions, findLoggedScore, useAllTime, useStandings } from '../lib/store.js';
import { friendlyError } from '../lib/errors.js';
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
import PixelEmoji from '../components/PixelEmoji.jsx';

const UNDO_MS = 15 * 60 * 1000;

// ---------- "same crew as last game" ----------
// After a multi-score photo we remember who stood in which slot, so the next game with the
// same group is one tap. Per phone, expires after 2 hours.
const CREW_KEY = 'pw.crew';
const CREW_MS = 2 * 60 * 60 * 1000;
function loadCrew(meId) {
  try {
    const c = JSON.parse(localStorage.getItem(CREW_KEY) || 'null');
    if (!c || c.me !== meId || Date.now() - c.at > CREW_MS) return null;
    return c.slots || null; // { [slot]: playerId }
  } catch { return null; }
}
function saveCrew(meId, rows) {
  const slots = {};
  for (const r of rows) if (r.slot && r.who != null) slots[r.slot] = r.who === 'me' ? meId : r.who;
  if (Object.keys(slots).length < 2) return;
  try { localStorage.setItem(CREW_KEY, JSON.stringify({ me: meId, at: Date.now(), slots })); } catch { /* private mode */ }
}

// Build assign rows from a read: scores someone already logged are matched to that person;
// other slots get last game's crew. No guessing beyond that: she taps which slot was hers.
// Nobody lands in two slots.
function buildRows(read, { scores, mid, me, players, keyPrefix, taken = new Set(), useCrew = true }) {
  taken = new Set(taken);
  const rows = read.map((s, i) => {
    const row = { key: `${keyPrefix}${s.slot ?? ''}-${i}`, slot: s.slot, value: s.value, who: undefined };
    const hit = findLoggedScore(scores, { machineId: mid, value: s.value });
    if (hit) {
      const who = hit.player_id === me.id ? 'me' : hit.player_id;
      if (!taken.has(who)) {
        taken.add(who);
        return { ...row, who, existing: { scoreId: hit.id, loggedBy: hit.logged_by ?? hit.player_id } };
      }
    }
    return row;
  });
  const crew = useCrew ? loadCrew(me.id) : null;
  const alive = new Set(players.map(p => p.id));
  if (crew) {
    for (const r of rows) {
      if (r.who !== undefined || !r.slot) continue;
      const pid = crew[r.slot];
      if (!pid || !alive.has(pid)) continue;
      const who = pid === me.id ? 'me' : pid;
      if (taken.has(who)) continue;
      taken.add(who); r.who = who; r.fromCrew = true;
    }
  }
  return rows;
}

// Steps live in history state (location.state.step), so the phone's Back button walks
// back through the flow (confirm → keypad → start) instead of dumping you on Home.
//   start   → big art, "📸 Snap the score" / "or type it"
//   reading → photo being read
//   pad     → keypad (single score, me or another player)
//   confirm → big DMD number + machine, plausibility + crown checks, Submit / Fix it
//   assign  → "Who was who?" (multi-score photo) or "Log your friends' scores"
//   done    → results; undo; next suggestion; log friends
export default function Machine() {
  const { id } = useParams();
  const mid = Number(id);
  const { machines, players, scores, me, standings, party, ready, events } = useStandings();
  const loc = useLocation();
  const nav = useNavigate();

  const [photo, setPhoto] = useState(null);       // JPEG data URL of the score display
  const [readInfo, setReadInfo] = useState(null);  // { confidence, note, failed }
  const [pad, setPad] = useState('');              // keypad digits for a single score
  const [forWho, setForWho] = useState('me');      // single score is for 'me' or a player id
  const [whoOpen, setWhoOpen] = useState(false);
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
    setPhoto(null); setReadInfo(null); setPad(''); setForWho('me'); setRows([]); setResults([]); setNotice(''); setErr('');
  }, [mid]); // eslint-disable-line react-hooks/exhaustive-deps

  const machine = machines.find(m => m.id === mid);
  const machineScores = useMemo(() => scores.filter(s => s.machine_id === mid && !s.voided), [scores, mid]);

  if (!ready) return <Loading />;
  if (!me) return null; // App redirects to /join
  if (!machine) {
    return (
      <div className="screen">
        <Link className="back-link" to="/">‹ All machines</Link>
        <div className="err">Not in tonight's lineup.</div>
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
      setErr('No connection — nothing was saved. Check Wi-Fi and try again (your number is kept).');
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
    setRows(buildRows(r.scores, { scores, mid, me, players, keyPrefix: 's' }));
    goStep('assign', { replace: true });
  }

  // ---------- one score (mine, or for another player) ----------
  async function submitSolo() {
    const value = Number(pad);
    if (!value || !lock()) return;
    const isMe = forWho === 'me' || forWho === me.id;
    const pid = isMe ? me.id : forWho;
    const snap = snapshotFor(pid, value);
    const { claimedTop } = crownInfo(value, pid, machineScores);
    try {
      const r = isMe
        ? await actions.submitScore(mid, value, { photo, claimedTop })
        : await actions.submitScoreFor(pid, mid, value, { photo, claimedTop });
      setResults([{ key: `${isMe ? 'me' : pid}-${r.score_id}`, who: isMe ? 'me' : 'friend', playerId: pid, value, scoreId: r.score_id, ...dupOf(r), at: Date.now(), ...snap }]);
      setPad('');
      goStep('done', { replace: true });
    } catch (e) {
      setErr(friendlyError(e, !isMe));
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
        out.push({ key: `${pid}-${res.score_id}`, who: r.who === 'me' ? 'me' : 'friend', playerId: pid, value: r.value, scoreId: res.score_id, ...dupOf(res), at: Date.now(), ...snap });
        rowPatch[r.key] = { ok: true, error: null, existing: res.duplicate ? { scoreId: res.score_id, loggedBy: res.logged_by ?? null } : null };
      } catch (e) {
        const msg = friendlyError(e, r.who !== 'me');
        out.push({ key: `${pid}-err-${r.key}`, who: r.who === 'me' ? 'me' : 'friend', playerId: pid, value: r.value, error: msg, ...snap });
        rowPatch[r.key] = { ok: false, error: msg };
      }
    }
    unlock();
    setRows(rs => rs.map(r => (rowPatch[r.key] ? { ...r, ...rowPatch[r.key] } : r)));
    if (groupMode === 'photo') saveCrew(me.id, rows.filter(r => !rowPatch[r.key] || rowPatch[r.key].ok));
    const anyOk = out.some(x => !x.error);
    if (!anyOk) { setErr(out[0]?.error || 'Nothing logged. Try again.'); return; }
    setResults(prev => [...prev.filter(p => !out.some(o => o.playerId === p.playerId && p.error)), ...out]);
    goStep('done', { replace: true });
  }

  async function retryFriend(res) {
    if (!lock()) return;
    try {
      const { claimedTop } = crownInfo(res.value, res.playerId, machineScores);
      const r = await actions.submitScoreFor(res.playerId, mid, res.value, { photo, claimedTop });
      setResults(list => list.map(x => (x.key === res.key ? { ...x, error: null, scoreId: r.score_id, ...dupOf(r), at: Date.now() } : x)));
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
      setNotice(`Removed ${fmt(res.value)}. Fix it and resubmit.`);
      goStep('pad', { replace: true });
    } catch (e) {
      setErr(friendlyError(e, false));
    } finally { unlock(); }
  }

  // Undo a score I logged for someone else (server allows logged_by = me, 15 min).
  async function undoFriend(res) {
    if (!lock()) return;
    try {
      await actions.undoScore(res.scoreId);
      setResults(list => list.filter(x => x.key !== res.key));
      const p = playerById.get(res.playerId);
      setNotice(`Removed ${fmt(res.value)} for ${p?.display_name ?? 'them'}.`);
    } catch (e) {
      setErr(friendlyError(e, true));
    } finally { unlock(); }
  }

  // "‹ Cancel": drop what's in progress and go back to this machine's start.
  function cancelFlow() {
    setPhoto(null); setReadInfo(null); setPad(''); setForWho('me'); setRows([]); setResults([]); setNotice(''); setErr('');
    goStep('start', { replace: true });
  }

  function startFriends() {
    setGroupMode('friends');
    setErr('');
    setRows([{ key: `f${Date.now()}`, slot: null, value: null, who: undefined, autoPick: true }]);
    goStep('assign');
  }

  function logAnother() {
    setPhoto(null); setReadInfo(null); setPad(''); setForWho('me'); setRows([]); setResults([]); setNotice(''); setErr('');
    goStep('start', { replace: true });
  }

  function switchTo(m) {
    setSwitcher(false);
    afterSheetClose(() => nav(`/machine/${m.id}`, { replace: true, state: { ...(loc.state || {}), keep: true } }));
  }

  const myLoggedHere = results.some(r => r.who === 'me' && !r.error);
  const forPlayer = forWho === 'me' ? me : playerById.get(forWho) || me;
  const forIsMe = forPlayer.id === me.id;
  const forStats = standings.stats.get(forPlayer.id)?.perMachine[mid] ?? null;
  const topBest = board?.champion?.score ?? null;
  const padHint = forStats
    ? `${forIsMe ? 'Your' : `${forPlayer.display_name}'s`} best: ${fmtShort(forStats.best)}${topBest ? ` · #1: ${fmtShort(topBest)}` : ''}`
    : topBest
    ? `#1 to beat: ${fmtShort(topBest)}`
    : undefined;
  const whoChip = <ForWhoChip player={forPlayer} isMe={forIsMe} onChange={() => setWhoOpen(true)} />;

  return (
    <div className={`screen machine-flow step-${step}`}>
      {step === 'start' && (
        <StartStep
          machine={machine} mineHere={mineHere} board={board} closed={closed}
          onSwitch={() => setSwitcher(true)} onSnap={onSnap} onType={() => { setPhoto(null); setReadInfo(null); setNotice(''); goStep('pad'); }}
          onPhotoError={setErr} me={me}
        />
      )}

      {step === 'start' && notice && <div className="note-ok">{notice}</div>}

      {step === 'reading' && <MachineStrip machine={machine} onSwitch={() => setSwitcher(true)} onCancel={cancelFlow} />}
      {step === 'reading' && <ReadingStep machine={machine} photo={photo} onCancel={() => { setReadInfo({ failed: true }); goStep('pad', { replace: true }); }} />}

      {step === 'pad' && (
        <>
          <MachineStrip machine={machine} onSwitch={() => setSwitcher(true)} onCancel={cancelFlow} />
          {whoChip}
          {notice && <div className="note-ok">{notice}</div>}
          {photo && (
            <button type="button" className="photo-strip" onClick={() => setViewPhoto(true)}>
              <img src={photo} alt="your photo of the score" />
              <span className="photo-strip-label">{readInfo?.failed ? "Can't read it. Type what you see" : 'Your photo · tap to zoom'}</span>
            </button>
          )}
          <ScorePad value={pad} onChange={setPad} hint={padHint} />
          <div className={photo ? 'actionbar' : 'actionbar two'}>
            {!photo && (
              <PhotoButton className="ghost-btn" onPhoto={onSnap} onError={setErr}>📸 Snap it</PhotoButton>
            )}
            <button type="button" className="cta" disabled={!Number(pad)} onClick={() => goStep('confirm')}>
              Next
            </button>
          </div>
        </>
      )}

      {step === 'confirm' && (
        <ConfirmStep
          machine={machine} board={board} value={Number(pad)} photo={photo} readInfo={readInfo} me={me}
          forPlayer={forPlayer} whoChip={whoChip} onCancel={cancelFlow}
          machineScores={machineScores} playerById={playerById} busy={busy}
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
          busy={busy} onSubmit={submitGroup} onSwitch={() => setSwitcher(true)} onCancel={cancelFlow}
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
          playerById={playerById} busy={busy} notice={notice}
          onUndo={undoMine} onUndoFriend={undoFriend} onRetry={retryFriend} onFriends={startFriends} onAnother={logAnother}
        />
      )}

      {err && <div className="err" role="alert">{err}</div>}

      {(step === 'start' || step === 'done') && <TopScores board={board} me={me} mineHere={mineHere} mid={mid} multiEvent={(events?.length ?? 0) > 1} />}

      <Sheet open={whoOpen} onClose={() => setWhoOpen(false)} title="Whose score is this?" tall>
        <PlayerPicker
          players={players} scores={scores} me={me} machineId={mid} allowMe
          onPick={who => { setForWho(who === 'me' ? 'me' : who); setWhoOpen(false); }}
        />
      </Sheet>

      <Sheet open={switcher} onClose={() => setSwitcher(false)} title="Which machine?">
        <div className="switch-list">
          {machines.map(m => (
            <button key={m.id} type="button" className={`switch-row${m.id === mid ? ' on' : ''}`} onClick={() => switchTo(m)}>
              <img src={machineArt(m.name)} alt="" />
              <span className="switch-name">{m.name}<span className="switch-meta">{m.manufacturer} · {m.year}</span></span>
              {m.id === mid && <span className="switch-here">HERE</span>}
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

// RPC result → { duplicate, loggedBy }. loggedBy: who logged the existing row (null if unknown).
function dupOf(r) {
  return { duplicate: !!r?.duplicate, loggedBy: r?.duplicate ? r.logged_by ?? null : null };
}

// "ALREADY LOGGED ✓" / "ALREADY LOGGED BY [avatar] TINA ✓"
function AlreadyLogged({ by, me, playerById, className = '' }) {
  const p = by != null && by !== me.id ? playerById.get(by) : null;
  return (
    <span className={`dup-tag ${className}`}>
      {p ? (
        <>Already logged by <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={20} /> <strong>{p.display_name}</strong> ✓</>
      ) : 'Already logged ✓'}
    </span>
  );
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
              : <span className="rank-pill new">PLAY ME!</span>}
          </div>
        </div>
      </div>

      {closed ? (
        <div className="err">Scoring's closed. Finals are on the TV.</div>
      ) : (
        <div className="start-actions">
          <PhotoButton className="snap-btn" onPhoto={onSnap} onError={onPhotoError}>
            <span className="snap-icon" aria-hidden="true"><PixelEmoji e="📸" size={40} /></span>
            <span className="snap-text">
              <span className="snap-title">Snap the score</span>
              <span className="snap-sub">Aim at the scores</span>
            </span>
          </PhotoButton>
          <button type="button" className="type-btn" onClick={onType}>or type it in</button>
          {mineHere && <div className="muted small center-text">Your best: <span className="mono amber">{fmt(mineHere.best)}</span></div>}
        </div>
      )}
      <Link to={`/machine/${machine.id}/guide`} className="guide-chip">📖 About this machine</Link>
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
      <div className="muted small center-text">Reading the display…</div>
      <button type="button" className="type-btn" onClick={onCancel}>Skip · type it</button>
    </div>
  );
}

// "Logging for: [avatar] Name (you) · Change" on the keypad and confirm steps.
function ForWhoChip({ player, isMe, onChange }) {
  return (
    <button type="button" className={`forwho${isMe ? '' : ' other'}`} onClick={onChange}>
      <span className="forwho-label">Logging for:</span>
      <Avatar avatar={player.avatar} emoji={player.emoji} name={player.display_name} color={player.color} size={26} />
      <span className="forwho-name">{player.display_name}{isMe ? ' (you)' : ''}</span>
      <span className="forwho-change">Change</span>
    </button>
  );
}

function CancelLink({ onCancel }) {
  return <button type="button" className="flow-cancel" onClick={onCancel}>‹ Cancel</button>;
}

function MachineStrip({ machine, onSwitch, onCancel }) {
  return (
    <>
    {onCancel && <CancelLink onCancel={onCancel} />}
    <div className="mstrip">
      <img src={machineArt(machine.name)} alt="" />
      <div className="mstrip-shade" />
      <div className="mstrip-text">
        <div className="mstrip-label">Logging on</div>
        <div className="mstrip-name">{machine.name}</div>
      </div>
      <button type="button" className="mstrip-switch" onClick={onSwitch}>Wrong one?</button>
    </div>
    </>
  );
}

// Warnings + crown checks shared by the single-score confirm and the group screen.
function preflight(value, pid, machine, machineScores, photo) {
  const warnings = checkScore(value, machine, machineScores);
  const crown = crownInfo(value, pid, machineScores);
  return { warnings, crown, needsPhoto: crown.contested && !photo };
}

function ConfirmStep({ machine, board, value, photo, readInfo, me, forPlayer, whoChip, onCancel, machineScores, playerById, busy, onAttach, onPhotoError, onFix, onSubmit, onSwitch }) {
  const pid = forPlayer.id;
  const isMe = pid === me.id;
  const { warnings, crown, needsPhoto } = preflight(value, pid, machine, machineScores, photo);
  const fromPhoto = !!photo && readInfo && !readInfo.failed;
  // Someone already logged this exact score here: this player's (nothing to do) or someone else's game?
  const hit = findLoggedScore(machineScores, { machineId: machine.id, value });
  const mineAlready = hit && hit.player_id === pid;
  const theirs = hit && !mineAlready ? playerById.get(hit.player_id) : null;
  const theirsIsMe = theirs && theirs.id === me.id;
  const rowsHere = board?.rows ?? [];
  const prevBest = rowsHere.find(r => r.playerId === pid)?.best ?? null;
  const effBest = prevBest != null ? Math.max(prevBest, value) : value;
  const otherBests = rowsHere.filter(r => r.playerId !== pid).map(r => r.best);
  const projRank = 1 + otherBests.filter(b => b > effBest).length;
  const projTotal = otherBests.length + 1;
  return (
    <>
      <CancelLink onCancel={onCancel} />
      <div className="confirm-card">
        <div className="confirm-art">
          <img src={machineArt(machine.name)} alt="" />
          <div className="confirm-art-shade" />
          <div className="confirm-machine">{machine.name}</div>
          <button type="button" className="mstrip-switch" onClick={onSwitch}>Wrong one?</button>
        </div>
        <div className="confirm-body">
          <div className="confirm-label">{fromPhoto ? 'We read' : 'You typed'}</div>
          <LedNumber value={value} size="xl" />
          <div className="confirm-say">≈ {sayNumber(value)}</div>
          {!mineAlready && (
            <div className={`confirm-preview${prevBest != null && value <= prevBest ? ' below' : ''}`}>
              {crown.claimedTop
                ? `👑 #1 on ${machine.name}!`
                : prevBest == null
                ? `First score here · ${ordinal(projRank)} of ${projTotal}`
                : value > prevBest
                ? `★ New best! (was ${fmtShort(prevBest)}) · ${ordinal(projRank)} of ${projTotal}`
                : `Below best (${fmtShort(prevBest)}) · ${ordinal(projRank)} of ${projTotal}`}
            </div>
          )}
          {fromPhoto && readInfo.confidence !== 'high' && <div className="hint">Blurry. Check it matches the machine.</div>}
          {fromPhoto && readInfo.note && <div className="muted small center-text">{readInfo.note}</div>}
        </div>
      </div>

      {whoChip}

      {mineAlready && (
        <div className="dup-card">
          {!isMe && <span className="dup-for">{forPlayer.display_name}: </span>}
          <AlreadyLogged by={hit.logged_by ?? hit.player_id} me={me} playerById={playerById} />
        </div>
      )}
      {theirs && (
        <div className="warn-card">
          <div className="warn-title">🤔 {theirsIsMe ? 'You already have' : `${theirs.display_name} has`} this exact score</div>
          <div className="warn-detail">
            {isMe ? "Their game? Tap \"Logging for\" above to log it for them instead."
              : theirsIsMe ? `Was it your game, not ${forPlayer.display_name}'s? Then it's already in.`
              : `Only log it for ${forPlayer.display_name} if it was their game.`}
          </div>
        </div>
      )}

      {!mineAlready && warnings.map(w => (
        <div key={w.kind} className="warn-card">
          <div className="warn-title">🤔 {w.title}</div>
          <div className="warn-detail">{w.detail}</div>
        </div>
      ))}

      {!mineAlready && crown.claimedTop && (
        <div className={`crown-card${needsPhoto ? ' needs' : ''}`}>
          <div className="crown-title">👑 {crown.contested ? `Beats tonight's best (${fmt(crown.othersBest)})` : 'First score here!'}</div>
          {needsPhoto ? (
            <>
              <div className="crown-detail">Add a photo so the host can verify the #1 — or skip it.</div>
              <PhotoButton className="snap-btn small" onPhoto={onAttach} onError={onPhotoError}>
                <span className="snap-icon" aria-hidden="true"><PixelEmoji e="📸" size={40} /></span>
                <span className="snap-title">Add a photo</span>
              </PhotoButton>
            </>
          ) : photo ? (
            <div className="crown-detail">📸 Photo attached.</div>
          ) : null}
        </div>
      )}

      <div className="actionbar two">
        <button type="button" className="ghost-btn" onClick={onFix} disabled={busy}>✏️ Fix it</button>
        <button type="button" className={`cta${needsPhoto ? ' cta-soft' : ''}`} onClick={onSubmit} disabled={busy}>
          {busy ? 'Saving…' : mineAlready ? 'OK ✓' : needsPhoto ? 'Submit without photo' : warnings.length ? "It's right" : theirs ? (isMe ? "It's mine" : `It's ${forPlayer.display_name}'s`) : 'Submit'}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function AssignStep({ mode, machine, rows, setRows, photo, readInfo, me, players, scores, machineScores, allowMe, myLoggedValue,
  busy, onSubmit, onSwitch, onCancel, onViewPhoto, onAttach, onPhotoError, onReadMore }) {
  const [pickFor, setPickFor] = useState(null);   // row key
  const [skipMe, setSkipMe] = useState(false);    // "I didn't play, just logging others" 
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
  // Already on the board? (same rule as the server). Logged rows keep what the server said.
  const already = r => {
    if (r.ok) return r.existing || null;
    if (r.who == null || !(r.value > 0)) return null;
    const hit = findLoggedScore(scores, { playerId: pid(r), machineId: machine.id, value: r.value });
    return hit ? { scoreId: hit.id, loggedBy: hit.logged_by ?? hit.player_id } : null;
  };
  const readyRows = rows.filter(r => r.who != null && r.value > 0 && !r.ok);
  const newCount = readyRows.filter(r => !already(r)).length;
  const crewRows = rows.filter(r => r.fromCrew && !r.ok).length;
  const unresolved = rows.filter(r => !r.ok && (r.who === undefined || (r.who !== null && !(r.value > 0))));
  const checks = readyRows.filter(r => !already(r)).map(r => ({ r, ...preflight(r.value, pid(r), machine, machineScores, photo) }));
  const flagged = checks.filter(c => c.warnings.length || c.needsPhoto);
  // Group photo: she must say which slot was hers (or that she didn't play) before logging.
  const needMe = mode === 'photo' && allowMe && !skipMe && !rows.some(r => r.who === 'me');

  function pick(key, who) {
    const editAfter = rows.find(r => r.key === key && !(r.value > 0)) && who !== null;
    setRows(rs => rs.map(r => {
      if (r.key === key) return r.who === who ? r : { ...r, who, error: null, existing: null, fromCrew: false };
      if (who != null && r.who === who) return { ...r, who: undefined, existing: null, fromCrew: false }; // someone can only be one slot
      return r;
    }));
    setPickFor(null);
    if (editAfter) afterSheetClose(() => { setEditVal(''); setEditFor(key); });
  }
  function openEdit(r) { setEditVal(r.value ? String(r.value) : ''); setEditFor(r.key); }
  function saveEdit() {
    const v = Number(editVal) || null;
    setRows(rs => rs.map(r => (r.key === editFor ? { ...r, value: v, error: null, ...(v !== r.value ? { existing: null } : {}) } : r)));
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
    if (!r) { onPhotoError("Can't read that photo. Add scores by hand."); return; }
    const fresh = r.scores.filter(s => s.value !== myLoggedValue);
    setRows(rs => {
      const keep = rs.filter(x => x.ok || x.who != null || x.value);
      const taken = new Set(keep.filter(x => x.who != null).map(x => x.who));
      if (!allowMe) taken.add('me');
      return [...keep, ...buildRows(fresh, { scores, mid: machine.id, me, players, keyPrefix: `p${Date.now()}-`, taken, useCrew: false })];
    });
  }

  const editRow = rows.find(r => r.key === editFor);
  const editWho = editRow?.who === 'me' ? me : editRow?.who != null ? playerById.get(editRow.who) : null;
  const editTitle = editRow?.value ? 'Fix score' : editWho ? `${editWho.display_name}'s score` : 'Enter score';
  const editWhoChip = editWho && (
    <div className="who-chip">
      <Avatar avatar={editWho.avatar} emoji={editWho.emoji} name={editWho.display_name} color={editWho.color} size={24} />
      <span className="who-chip-name">{editRow?.who === 'me' ? `${editWho.display_name} (me)` : editWho.display_name}</span>
    </div>
  );

  const submitClick = () => (flagged.length ? setCheckOpen(true) : onSubmit());

  return (
    <>
      <MachineStrip machine={machine} onSwitch={onSwitch} onCancel={onCancel} />
      <div className="assign-head">
        <h1>{needMe ? 'Which player were you?' : mode === 'photo' ? 'Who was who?' : 'Log for other players'}</h1>
        <div className="muted small">
          {needMe
            ? `We read ${rows.length} scores. Tap "That's me" on your score.`
            : mode === 'photo'
            ? 'Tap a name to say who played that slot. Tap a number to fix it.'
            : 'Pick a player, then type their score.'}
        </div>
        {needMe && (
          <button type="button" className="linkbtn small" onClick={() => setSkipMe(true)}>I didn't play — just logging others</button>
        )}
        {crewRows > 0 && <div className="crew-hint">↺ Same players as last game — tap a name to change.</div>}
      </div>

      {photo && (
        <button type="button" className="photo-strip" onClick={onViewPhoto}>
          <img src={photo} alt="your photo of the score" />
          <span className="photo-strip-label">
            {readInfo?.confidence === 'low' ? '⚠️ Blurry. Check each · tap to zoom' : 'Your photo · tap to zoom'}
          </span>
        </button>
      )}
      {readInfo?.note && <div className="muted small">{readInfo.note}</div>}

      <div className="assign-list">
        {rows.map((r, i) => {
          const p = r.who === 'me' ? me : r.who != null ? playerById.get(r.who) : null;
          const dup = already(r);
          const c = r.who != null && r.value > 0 && !dup ? preflight(r.value, pid(r), machine, machineScores, photo) : null;
          return (
            <div key={r.key} className={`assign-row${r.who === null ? ' skipped' : ''}${r.ok ? ' done' : ''}${dup ? ' dup' : ''}`}>
              <div className="assign-top">
                <span className="slot-label">{r.slot ? `PLAYER ${r.slot}` : `FRIEND ${i + 1}`}</span>
                {r.ok && !dup && <span className="ok-pill">✓ logged</span>}
                {dup && <span className="ok-pill dup-pill">✓ already in</span>}
                {mode === 'photo' && !r.ok && r.who === undefined && (
                  <button type="button" className="row-skip" onClick={() => pick(r.key, null)}>Skip</button>
                )}
                {mode === 'friends' && !r.ok && (
                  <button type="button" className="row-x" aria-label="Remove" onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>✕</button>
                )}
              </div>
              {mode === 'friends' ? (
                <>
                  <button type="button" className={`assignee${p ? '' : ' empty'}`} disabled={r.ok} onClick={() => setPickFor(r.key)}>
                    {r.who === null ? (
                      <><span className="assignee-skip">⤼</span><span>Skipped · tap to add</span></>
                    ) : p ? (
                      <><Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={30} />
                        <span className="assignee-name">{r.who === 'me' ? `${p.display_name} (me)` : p.display_name}</span>
                        {!r.ok && <span className="assignee-change">change</span>}</>
                    ) : (
                      <><span className="assignee-plus">？</span><span>Who is this?</span></>
                    )}
                  </button>
                  <LedNumber
                    value={r.value || ''} size="md" placeholder="TAP TO ENTER SCORE"
                    onClick={r.ok || r.who === null ? undefined : () => openEdit(r)}
                    label={r.value ? `Player ${r.slot ?? i + 1} score ${fmt(r.value)}, tap to fix` : 'Enter score'}
                  />
                </>
              ) : (
                <>
                  <LedNumber
                    value={r.value || ''} size="md" placeholder="TAP TO ENTER"
                    onClick={r.ok || r.who === null ? undefined : () => openEdit(r)}
                    label={r.value ? `Player ${r.slot ?? i + 1} score ${fmt(r.value)}, tap to fix` : 'Enter score'}
                  />
                  {needMe && r.who === undefined && !r.ok && (
                    <button type="button" className="cta cta-soft thats-me" onClick={() => pick(r.key, 'me')}>That's me</button>
                  )}
                  <button type="button" className={`assignee${p ? '' : ' empty'}`} disabled={r.ok} onClick={() => setPickFor(r.key)}>
                    {r.who === null ? (
                      <><span className="assignee-skip">⤼</span><span>Skipped · tap to add</span></>
                    ) : p ? (
                      <><Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={30} />
                        <span className="assignee-name">{r.who === 'me' ? `${p.display_name} (me)` : p.display_name}</span>
                        {!r.ok && <span className="assignee-change">change</span>}</>
                    ) : (
                      <><span className="assignee-plus">？</span><span>{needMe ? 'Someone else? Tap to pick' : 'Who is this?'}</span></>
                    )}
                  </button>
                </>
              )}
              {dup && dup.loggedBy != null && dup.loggedBy !== pid(r) && dup.loggedBy !== me.id && (
                <AlreadyLogged by={dup.loggedBy} me={me} playerById={playerById} className="row-dup" />
              )}
              {c?.warnings.map(w => <div key={w.kind} className="row-warn"><PixelEmoji e="🤔" size={22} /> <strong>{w.title}</strong> {w.detail}</div>)}
              {c?.crown.claimedTop && <div className="row-crown">👑 {c.crown.contested ? 'New record!' : 'First on the board'}{c.needsPhoto ? ' Add a photo.' : ''}</div>}
              {r.error && <div className="row-err">{r.error}</div>}
            </div>
          );
        })}
      </div>

      <div className="assign-tools">
        <button type="button" className="ghost-btn" onClick={addRow}>＋ Add player</button>
        {mode === 'friends' && !photo && (
          <PhotoButton className="ghost-btn" onPhoto={snapMore} onError={onPhotoError} disabled={reading}>
            {reading ? 'Reading…' : '📸 Snap scores'}
          </PhotoButton>
        )}
      </div>

      <div className="actionbar">
        {!needMe && unresolved.length > 0 && readyRows.length > 0 && (
          <div className="actionbar-hint">{unresolved.length} unassigned · will be skipped</div>
        )}
        {needMe && <div className="actionbar-hint">First, tap "That's me" on your score.</div>}
        <button type="button" className="cta" disabled={busy || readyRows.length === 0 || needMe} onClick={submitClick}>
          {busy ? 'Saving…'
            : needMe ? 'Which one was you?'
            : newCount ? `Log ${newCount} score${newCount === 1 ? '' : 's'}`
            : readyRows.length ? 'Done ✓'
            : 'Pick who scored'}
        </button>
      </div>

      <Sheet open={pickFor != null} onClose={() => setPickFor(null)} title="Whose score?" tall>
        <PlayerPicker
          players={players} scores={scores} me={me} machineId={machine.id}
          exclude={new Set([...assignedIds].filter(x => x !== rows.find(r => r.key === pickFor)?.who))}
          allowMe={allowMe} allowSkip={mode === 'photo'}
          onPick={who => pick(pickFor, who)}
        />
      </Sheet>

      <Sheet open={editFor != null} onClose={() => setEditFor(null)} title={editTitle} tall>
        {editWhoChip}
        {photo && <img className="photo-mini" src={photo} alt="" />}
        <ScorePad value={editVal} onChange={setEditVal} />
        <div className="sheet-actions">
          <button type="button" className="cta" disabled={!editVal} onClick={saveEdit}>Done</button>
        </div>
      </Sheet>

      <Sheet open={checkOpen} onClose={() => setCheckOpen(false)} title="Double-check">
        <div className="check-list">
          {flagged.map(({ r, warnings, needsPhoto }) => {
            const p = r.who === 'me' ? me : playerById.get(r.who);
            return (
              <div key={r.key} className="check-item">
                <div className="check-who">
                  <Avatar avatar={p?.avatar} emoji={p?.emoji} name={p?.display_name} color={p?.color} size={24} />
                  <span className="check-who-name">{p?.display_name}:</span> <span className="mono amber">{fmt(r.value)}</span>
                </div>
                {warnings.map(w => <div key={w.kind} className="warn-detail"><PixelEmoji e="🤔" size={22} /> <strong>{w.title}</strong> {w.detail}</div>)}
                {needsPhoto && <div className="warn-detail">👑 New #1 needs a photo</div>}
              </div>
            );
          })}
          {flagged.some(f => f.needsPhoto) && (
            <PhotoButton className="snap-btn small" onPhoto={d => onAttach(d)} onError={onPhotoError}>
              <span className="snap-icon" aria-hidden="true"><PixelEmoji e="📸" size={40} /></span><span className="snap-title">Add a photo</span>
            </PhotoButton>
          )}
        </div>
        <div className="sheet-actions two">
          <button type="button" className="ghost-btn" onClick={() => setCheckOpen(false)}>✏️ Fix it</button>
          <button type="button" className="cta" disabled={busy} onClick={() => { setCheckOpen(false); afterSheetClose(onSubmit); }}>Log them</button>
        </div>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
function DoneStep({ machine, machines, results, standings, me, playerById, busy, notice, onUndo, onUndoFriend, onRetry, onFriends, onAnother }) {
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

  const loggedFriends = friends.filter(f => !f.error);
  const newFriends = loggedFriends.filter(f => !f.duplicate);
  const oneName = newFriends.length === 1 ? playerById.get(newFriends[0].playerId)?.display_name : null;
  const title = !mine ? (oneName ? `Logged for ${oneName}` : newFriends.length ? `Logged ${newFriends.length} scores` : 'Already logged ✓')
    : mine.duplicate ? 'Already logged ✓'
    : tookCrown ? 'You took the crown!'
    : isPB && mine.prevBest != null ? 'New personal best!'
    : 'Score logged!';

  const next = nextSuggestion(machines, myStats, machine.id);

  return (
    <>
      <div className={`done-card${tookCrown ? ' crowned' : ''}`}>
        {tookCrown && <Confetti count={110} />}
        {tookCrown && <div className="done-crown" aria-hidden="true"><PixelEmoji e="👑" size={72} grid={16} /></div>}
        {mine && !mine.duplicate && <div className="done-kicker" aria-hidden="true">{tookCrown ? 'NEW HIGH SCORE!' : 'STAGE CLEAR!'}</div>}
        {mine ? (
          <div className="done-hero-avatar">
            <Avatar avatar={me.avatar} emoji={me.emoji} name={me.display_name} color={me.color} size={64} ring />
          </div>
        ) : loggedFriends.length > 0 && (
          <div className="done-hero-avatars">
            {loggedFriends.slice(0, 6).map(f => {
              const p = playerById.get(f.playerId);
              return <Avatar key={f.key} avatar={p?.avatar} emoji={p?.emoji} name={p?.display_name} color={p?.color} size={48} ring />;
            })}
          </div>
        )}
        <div className="done-machine">{machine.name}</div>
        <h1 className="done-title">{title}</h1>
        {mine?.duplicate && mine.loggedBy != null && mine.loggedBy !== me.id && (
          <AlreadyLogged by={mine.loggedBy} me={me} playerById={playerById} className="done-dup" />
        )}
        {mine && <LedNumber value={mine.value} size="xl" />}
        {mine && now && (
          <div className="done-stats">
            <div className="done-rank">
              <span className="done-rank-num">{ordinal(now.rank)}</span>
              <span className="done-rank-of">of {now.N}</span>
            </div>
            <div className="done-lines">
              {mine.duplicate ? <span className="done-sub">Counted once.</span>
                : mine.prevRank == null
                ? <span className="move new">NEW ENTRY</span>
                : climbed ? <span className="move up">↑ Up from {ordinal(mine.prevRank)}</span>
                : <span className="move flat">Still {ordinal(now.rank)}</span>}
              {!mine.duplicate && isPB && mine.prevBest != null && <span className="move pb">★ NEW BEST</span>}
              {!mine.duplicate && !isPB && <span className="done-sub">Your best ({fmt(now.best)}) still counts.</span>}
              {!mine.duplicate && mine.dethroned && (
                <span className="done-sub done-knocked">
                  Knocked{' '}
                  <span className="inline-who">
                    <Avatar avatar={mine.dethroned.avatar} emoji={mine.dethroned.emoji} name={mine.dethroned.display_name} color={mine.dethroned.color} size={24} />
                    <strong>{mine.dethroned.display_name}</strong>
                  </span>{' '}
                  off #1.
                </span>
              )}
              {!mine.duplicate && !mine.dethroned && mine.passed > 0 && mine.prevRank != null && <span className="done-sub">Passed {mine.passed} player{mine.passed === 1 ? '' : 's'}.</span>}
            </div>
          </div>
        )}
        {mine && !mine.duplicate && undoLeft > 0 && (
          <button type="button" className="undo-btn" disabled={busy} onClick={() => onUndo(mine)}>
            Typo? Undo <span className="undo-time">({Math.ceil(undoLeft / 60000)}m left)</span>
          </button>
        )}
      </div>

      {notice && <div className="note-ok">{notice}</div>}

      {friends.length > 0 && (
        <section className="panel">
          <h3>{mine ? 'Also logged' : 'Logged'}</h3>
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
                  {!f.error && (
                    <div className="fr-status">
                      {f.duplicate
                        ? <AlreadyLogged by={f.loggedBy === f.playerId ? null : f.loggedBy} me={me} playerById={playerById} />
                        : <span className="fr-new">✓ Logged</span>}
                      {!f.duplicate && f.scoreId && Date.now() - f.at < UNDO_MS && (
                        <button type="button" className="undo-btn small" disabled={busy} onClick={() => onUndoFriend(f)}>
                          Undo <span className="undo-time">{Math.ceil((UNDO_MS - (Date.now() - f.at)) / 60000)}m</span>
                        </button>
                      )}
                    </div>
                  )}
                  {f.error && (
                    <div className="fr-err">
                      {f.error}
                      {f.who !== 'me' && <button type="button" className="ghost-btn tiny" disabled={busy} onClick={() => onRetry(f)}>Retry</button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="muted small">Wrong one? Undo within 15 min.</div>
        </section>
      )}

      <button type="button" className="friends-btn" onClick={onFriends}>
        <span aria-hidden="true"><PixelEmoji e="👯" size={22} /></span> {friends.length ? 'Log more players' : 'Log scores for other players'}
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
        <button type="button" className="cta" onClick={onAnother}>Log another</button>
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
    return { machine: unplayed, line: `Try ${unplayed.name}${left > 1 ? ` · ${left} machines left` : ''}` };
  }
  const worst = others
    .map(m => ({ m, pm: st.perMachine[m.id] }))
    .filter(x => x.pm && x.pm.rank > 1)
    .sort((a, b) => a.pm.standing - b.pm.standing)[0];
  if (worst) return { machine: worst.m, line: `${ordinal(worst.pm.rank)} on ${worst.m.name}. Climb!` };
  return null;
}

function TopScores({ board, me, mineHere, mid, multiEvent }) {
  const [ever, setEver] = useState(false);
  const allTime = useAllTime();
  const b = ever ? allTime.machines.find(x => x.machine.id === mid) : board;
  const mine = ever ? (me ? allTime.stats.get(me.id)?.perMachine[mid] ?? null : null) : mineHere;
  return (
    <section className="panel top-scores">
      <div className="panel-head">
        <h3>High scores</h3>
        <Link to={`/ranks?m=${mid}${ever ? '&t=all' : ''}`} className="link small">All →</Link>
      </div>
      {multiEvent && (
        <div className="rk-scope ts-scope" role="tablist">
          <button role="tab" aria-selected={!ever} className={!ever ? 'on' : ''} onClick={() => setEver(false)}>Tonight</button>
          <button role="tab" aria-selected={ever} className={ever ? 'on' : ''} onClick={() => setEver(true)}>All-time</button>
        </div>
      )}
      {mine && <div className="muted small ts-you">You: {ordinal(mine.rank)} of {mine.N} · {fmt(mine.best)}</div>}
      {(!b || b.top.length === 0) && <div className="muted small">No scores yet. Be first!</div>}
      <ol className="ts-list">
        {b?.top.map(s => (
          <li key={s.player.id} className={s.player.id === me?.id ? 'mine' : ''}>
            <span className="ts-rank">{s.rank === 1 ? <PixelEmoji e="👑" size={16} grid={12} /> : s.rank}</span>
            <Avatar avatar={s.player.avatar} emoji={s.player.emoji} name={s.player.display_name} color={s.player.color} size={28} />
            <span className="ts-name">{s.player.display_name}</span>
            <span className="ts-val">{fmt(s.score)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
