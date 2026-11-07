import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { actions, useStandings } from '../lib/store.js';
import { machineArt } from '../lib/machineArt.js';
import { fmt, ordinal } from '../lib/scoring.js';
import Avatar from '../components/Avatar.jsx';

export default function Machine() {
  const { id } = useParams();
  const mid = Number(id);
  const { machines, me, standings, party, ready } = useStandings();
  const [logged, setLogged] = useState(null); // { scoreId, value, prevBest, prevRank }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const machine = machines.find(m => m.id === mid);
  if (!ready) return <div className="screen"><div className="muted">Loading…</div></div>;
  if (!machine) return <div className="screen"><Link className="back" to="/">← all machines</Link><div className="err">Unknown machine.</div></div>;

  const board = standings.machines.find(x => x.machine.id === mid);
  const mineHere = me ? standings.stats.get(me.id)?.perMachine[mid] : null;
  const closed = party?.status === 'closed';

  async function submit(value) {
    setBusy(true); setErr('');
    const prev = mineHere ? { prevBest: mineHere.best, prevRank: mineHere.rank } : {};
    try {
      const r = await actions.submitScore(mid, value);
      setLogged({ scoreId: r.score_id, value, duplicate: !!r.duplicate, ...prev });
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function undo() {
    setBusy(true); setErr('');
    try { await actions.undoScore(logged.scoreId); setLogged(null); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="screen machine">
      <Link className="back" to="/">← all machines</Link>
      <div className="machine-hero">
        <img src={machineArt(machine.name)} alt={machine.name} />
      </div>
      <div className="muted row spread">
        <span>{machine.manufacturer} · {machine.year}</span>
        <Link to={`/machine/${mid}/guide`} className="link">📖 how to play it</Link>
      </div>

      {closed ? (
        <div className="err">Scoring is closed for the night.</div>
      ) : logged ? (
        <LoggedCard logged={logged} now={mineHere} busy={busy} onUndo={undo} onAgain={() => setLogged(null)} />
      ) : (
        <ScorePad busy={busy} onSubmit={submit} />
      )}

      {err && <div className="err">{err}</div>}

      <section className="top10">
        <div className="row spread">
          <h3>Top scores</h3>
          {mineHere && <span className="muted small">You: {ordinal(mineHere.rank)} of {mineHere.N}</span>}
        </div>
        {(!board || board.top.length === 0) && <div className="muted small">No scores yet. Be first!</div>}
        <ol>
          {board?.top.map(s => (
            <li key={s.player.id} className={s.player.id === me?.id ? 'mine' : ''}>
              <span className="rank">{s.rank === 1 ? '👑' : s.rank}</span>
              <Avatar avatar={s.player.avatar} emoji={s.player.emoji} name={s.player.display_name} color={s.player.color} size={26} />
              <span className="name">{s.player.display_name}</span>
              <span className="val">{fmt(s.score)}</span>
            </li>
          ))}
        </ol>
        {mineHere && mineHere.rank > 10 && (
          <div className="your-best muted small">Your best: {fmt(mineHere.best)} ({ordinal(mineHere.rank)})</div>
        )}
      </section>
    </div>
  );
}

function LoggedCard({ logged, now, busy, onUndo, onAgain }) {
  const isPB = logged.prevBest == null || logged.value > logged.prevBest;
  const climbed = logged.prevRank != null && now && now.rank < logged.prevRank;
  return (
    <div className="entry logged">
      <h2>{logged.duplicate ? 'Already got that one 👍' : isPB ? (logged.prevBest == null ? 'Logged! 🎉' : 'New personal best! 🎉') : 'Logged!'}</h2>
      <div className="big-score">{fmt(logged.value)}</div>
      {now && (
        <div className="logged-line">
          You're <strong>{ordinal(now.rank)} of {now.N}</strong> on this machine
          {climbed ? <> (up from {ordinal(logged.prevRank)})</> : null}.
          {!isPB && <> Your best is still {fmt(now.best)}.</>}
        </div>
      )}
      <button className="primary big block" onClick={onAgain}>Log another game</button>
      <div className="row gap">
        <Link className="secondary grow center-text" to="/">Other machines</Link>
        <Link className="secondary grow center-text" to="/me">My progress</Link>
      </div>
      <button className="linkbtn small" disabled={busy} onClick={onUndo}>Typo? Undo this score</button>
    </div>
  );
}

function ScorePad({ busy, onSubmit }) {
  const [v, setV] = useState('');
  const push = d => setV(prev => (prev + d).replace(/^0+(?=\d)/, '').slice(0, 11));
  const n = Number(v);
  return (
    <div className="entry manual">
      <h2>Enter your score</h2>
      <div className="big-score">{v ? n.toLocaleString() : '0'}</div>
      <div className="pad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => <button key={d} type="button" onClick={() => push(String(d))}>{d}</button>)}
        <button type="button" onClick={() => setV('')}>C</button>
        <button type="button" onClick={() => push('0')}>0</button>
        <button type="button" onClick={() => setV(p => p.slice(0, -1))}>⌫</button>
      </div>
      <button className="primary big block" disabled={!v || busy} onClick={() => onSubmit(n)}>
        {busy ? 'Saving…' : 'Submit score'}
      </button>
      <div className="muted small center-text">Double-check it against the machine's display before you submit.</div>
    </div>
  );
}
