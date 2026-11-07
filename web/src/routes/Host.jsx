import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getHostPass, host, photoUrl, setHostPass, useParty } from '../lib/store.js';
import { fmt } from '../lib/scoring.js';
import Avatar from '../components/Avatar.jsx';
import PixelEmoji from '../components/PixelEmoji.jsx';

export default function Host() {
  const [authed, setAuthed] = useState(!!getHostPass());
  if (!authed) return <HostLogin onAuth={() => setAuthed(true)} />;
  return <HostPanel onLogout={() => { setHostPass(null); setAuthed(false); }} />;
}

function HostLogin({ onAuth }) {
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      if (!(await host.check(pass.trim()))) { setErr('Wrong passcode.'); return; }
      setHostPass(pass.trim());
      onAuth();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  return (
    <form className="screen form" onSubmit={submit}>
      <h1>Host</h1>
      <p className="muted">Enter the host passcode.</p>
      <input autoFocus type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="passcode" autoComplete="current-password" />
      {err && <div className="err">{err}</div>}
      <button className="primary big" disabled={busy} type="submit">Unlock</button>
    </form>
  );
}

function HostPanel({ onLogout }) {
  const { party, players, machines, scores } = useParty();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [matchDigits, setMatchDigits] = useState('');
  const [filter, setFilter] = useState('');

  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);
  const machineById = useMemo(() => new Map(machines.map(m => [m.id, m])), [machines]);
  const plays = useMemo(() => {
    const c = new Map();
    for (const s of scores) if (!s.voided) c.set(s.player_id, (c.get(s.player_id) || 0) + 1);
    return c;
  }, [scores]);

  async function run(fn, done) {
    setBusy(true); setMsg('');
    try { await fn(); if (done) setMsg(done); }
    catch (e) {
      if (/passcode/i.test(e.message)) { onLogout(); return; }
      setMsg(`⚠️ ${e.message}`);
    }
    finally { setBusy(false); }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return [...scores].sort((a, b) => b.id - a.id).filter(s => {
      if (!q) return true;
      const p = playerById.get(s.player_id), m = machineById.get(s.machine_id);
      return (p?.display_name ?? '').toLowerCase().includes(q) || (m?.name ?? '').toLowerCase().includes(q);
    }).slice(0, 150);
  }, [scores, filter, playerById, machineById]);

  const open = party?.status === 'open';

  return (
    <div className="screen host">
      <div className="row spread">
        <h1>Host</h1>
        <button className="ghost" onClick={onLogout}>Lock</button>
      </div>
      {msg && <div className={msg.startsWith('⚠️') ? 'err' : 'ok'}>{msg}</div>}

      <section className="card">
        <div className="row spread">
          <div>
            <h2>Scoring is {open ? 'OPEN' : 'CLOSED'}</h2>
            <div className="muted small">{players.length} players · {scores.filter(s => !s.voided).length} scores</div>
          </div>
          <button className={open ? 'secondary' : 'primary'} disabled={busy || !party}
            onClick={() => run(() => host.setStatus(open ? 'closed' : 'open'), open ? 'Scoring closed.' : 'Scoring reopened.')}>
            {open ? 'Close scoring' : 'Reopen scoring'}
          </button>
        </div>
        <div className="row gap">
          <a className="ghost" href="/tv" target="_blank" rel="noreferrer">Open TV board ↗</a>
          <a className="ghost" href="/host/qr" target="_blank" rel="noreferrer">Printable QR sheet ↗</a>
          <Link className="ghost" to="/host/test">🧪 Test &amp; calibrate scanner</Link>
        </div>
      </section>

      <section className="card">
        <h2>Winner reveal</h2>
        <p className="muted small">Takes over the TV: champion, machine champions, then the fun prizes. Close scoring first.</p>
        <label className="field">
          <span>The Match: draw a number 00–99 (optional)</span>
          <input type="number" min="0" max="99" value={matchDigits} onChange={e => setMatchDigits(e.target.value)} placeholder="e.g. 42" />
        </label>
        <div className="row gap">
          {!party?.reveal_active ? (
            <button className="primary big" disabled={busy}
              onClick={() => run(() => host.reveal(true, matchDigits === '' ? null : Number(matchDigits)), 'Reveal is on the TV.')}>🎉 Start reveal</button>
          ) : (
            <button className="secondary big" disabled={busy} onClick={() => run(() => host.reveal(false), 'Back to the leaderboard.')}>End reveal</button>
          )}
        </div>
      </section>

      <ReviewQueue scores={scores} playerById={playerById} machineById={machineById} busy={busy} run={run} />

      <AddScore players={players} machines={machines} busy={busy} run={run} />

      <section className="card">
        <div className="row spread">
          <h2>Scores</h2>
          <input className="host-filter" value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter by player or machine" />
        </div>
        <div className="table-wrap">
          <table className="host-table">
            <thead><tr><th>When</th><th>Player</th><th>Machine</th><th className="ralign">Score</th><th></th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={5} className="muted">No scores.</td></tr>}
              {shown.map(s => {
                const p = playerById.get(s.player_id);
                return (
                  <tr key={s.id} className={s.voided ? 'voided' : ''}>
                    <td className="muted small">{new Date(s.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
                    <td>{p?.emoji} {p?.display_name ?? '?'}{s.logged_by ? <span className="muted small"> (by {playerById.get(s.logged_by)?.display_name ?? '?'})</span> : null}</td>
                    <td>{machineById.get(s.machine_id)?.name}{s.photo_path ? <> <a href={photoUrl(s.photo_path)} target="_blank" rel="noreferrer" title="proof photo"><PixelEmoji e="📸" size={22} /></a></> : null}</td>
                    <td className="ralign mono">{fmt(s.value)}</td>
                    <td>
                      {s.voided
                        ? <button className="ghost" disabled={busy} onClick={() => run(() => host.voidScore(s.id, false))}>Restore</button>
                        : <button className="ghost danger" disabled={busy} onClick={() => run(() => host.voidScore(s.id, true))}>Void</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Players</h2>
        <div className="host-players">
          {[...players].sort((a, b) => a.display_name.localeCompare(b.display_name)).map(p => (
            <div key={p.id} className="host-player">
              <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={28} />
              <span className="grow">{p.display_name}{p.first_timer && <span className="player-ft">NEW</span>}</span>
              <span className="muted small">{plays.get(p.id) || 0} games</span>
              <button className="ghost" disabled={busy} onClick={() => {
                const pin = prompt(`New 4-digit PIN for ${p.display_name}:`);
                if (pin == null) return;
                run(() => host.resetPin(p.id, pin.trim()), `PIN reset for ${p.display_name}. Tell them it's ${pin.trim()}.`);
              }}>Reset PIN</button>
              <button className="ghost danger" disabled={busy} onClick={() => {
                if (!confirm(`Remove ${p.display_name} and all their scores? This can't be undone.`)) return;
                run(() => host.removePlayer(p.id), `${p.display_name} removed.`);
              }}>Remove</button>
            </div>
          ))}
          {players.length === 0 && <div className="muted small">No one has joined yet.</div>}
        </div>
      </section>

      <WipeCard busy={busy} run={run} />
    </div>
  );
}

// Scores that deserve a second look: a new #1 with no photo, or a score logged for someone else.
function ReviewQueue({ scores, playerById, machineById, busy, run }) {
  const queue = scores.filter(s => s.needs_review && !s.voided).sort((a, b) => b.id - a.id);
  if (!queue.length) return null;
  return (
    <section className="card review-card">
      <h2>Check these ({queue.length})</h2>
      <p className="muted small">New high scores without a photo, or scores someone logged for a friend. Glance at the machine or ask the player, then keep or void.</p>
      {queue.map(s => {
        const p = playerById.get(s.player_id);
        return (
          <div key={s.id} className="host-player">
            <span className="grow">
              <strong>{p?.display_name ?? '?'}</strong> · {machineById.get(s.machine_id)?.name} · <span className="mono">{fmt(s.value)}</span>
              {s.logged_by ? <span className="muted small"> · logged by {playerById.get(s.logged_by)?.display_name ?? '?'}</span> : null}
              {s.photo_path ? <> · <a className="link" href={photoUrl(s.photo_path)} target="_blank" rel="noreferrer">photo</a></> : null}
            </span>
            <button className="ghost" disabled={busy} onClick={() => run(() => host.markReviewed(s.id), 'Marked OK.')}>Looks right</button>
            <button className="ghost danger" disabled={busy} onClick={() => run(() => host.voidScore(s.id, true), 'Score voided.')}>Void</button>
          </div>
        );
      })}
    </section>
  );
}

function AddScore({ players, machines, busy, run }) {
  const [pid, setPid] = useState('');
  const [mid, setMid] = useState('');
  const [val, setVal] = useState('');
  const ok = pid && mid && /^\d+$/.test(val);
  return (
    <section className="card">
      <h2>Add a score for someone</h2>
      <p className="muted small">For anyone whose phone died.</p>
      <div className="host-add">
        <select value={pid} onChange={e => setPid(e.target.value)}>
          <option value="">Player…</option>
          {[...players].sort((a, b) => a.display_name.localeCompare(b.display_name)).map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
        <select value={mid} onChange={e => setMid(e.target.value)}>
          <option value="">Machine…</option>
          {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input inputMode="numeric" value={val} onChange={e => setVal(e.target.value.replace(/\D/g, ''))} placeholder="score" />
        <button className="primary" disabled={busy || !ok}
          onClick={() => run(async () => { await host.addScore(Number(pid), Number(mid), Number(val)); setVal(''); }, 'Score added.')}>Add</button>
      </div>
    </section>
  );
}

function WipeCard({ busy, run }) {
  const [txt, setTxt] = useState('');
  return (
    <section className="card danger-card">
      <h2>Start fresh</h2>
      <p className="muted small">Deletes every player and score (use this to clear out test data before the party). Type WIPE to confirm.</p>
      <div className="row gap">
        <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="WIPE" />
        <button className="ghost danger" disabled={busy || txt !== 'WIPE'}
          onClick={() => run(async () => { await host.wipe(txt); setTxt(''); }, 'Everything cleared.')}>Wipe everything</button>
      </div>
    </section>
  );
}
