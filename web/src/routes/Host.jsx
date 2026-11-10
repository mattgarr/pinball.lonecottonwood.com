import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getHostPass, host, photoUrl, setHostPass, useAwards, useParty, useStandings } from '../lib/store.js';
import { revealPlan } from '../components/Reveal.jsx';
import { fmt } from '../lib/scoring.js';
import { emailResults } from '../lib/emailResults.js';
import Avatar from '../components/Avatar.jsx';
import PixelEmoji from '../components/PixelEmoji.jsx';
import { hostPixelize } from '../lib/pixelAvatar.js';
import HostEvents from '../components/HostEvents.jsx';
import LightsPanel from '../components/LightsPanel.jsx';

const SITE_HOST = 'pinball.lonecottonwood.com';

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
      if (!(await host.check(pass.trim()))) { setErr('That passcode is not right. Check for typos.'); return; }
      setHostPass(pass.trim());
      onAuth();
    } catch { setErr('No connection. Check Wi-Fi and try again.'); }
    finally { setBusy(false); }
  }
  return (
    <form className="screen form" onSubmit={submit}>
      <h1>Host</h1>
      <p className="muted">For the people running the party. Enter the host passcode.</p>
      <input autoFocus type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="passcode" autoComplete="current-password" />
      {err && <div className="err">{err}</div>}
      <button className="primary big" disabled={busy} type="submit">Unlock</button>
      <p className="muted small">Only unlock on your own phone or laptop. Tap Lock when you're done on a shared device.</p>
    </form>
  );
}

function HostPanel({ onLogout }) {
  const { party, events, players, machines, scores, allScores, entrantIds, event } = useParty();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [filter, setFilter] = useState('');
  const [machineFilter, setMachineFilter] = useState('');
  const [playerScope, setPlayerScope] = useState('event'); // 'event' | 'all'
  const [playerFilter, setPlayerFilter] = useState('');

  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);
  const machineById = useMemo(() => new Map(machines.map(m => [m.id, m])), [machines]);
  const plays = useMemo(() => {
    const c = new Map();
    for (const s of scores) if (!s.voided) c.set(s.player_id, (c.get(s.player_id) || 0) + 1);
    return c;
  }, [scores]);
  const allPlays = useMemo(() => {
    const c = new Map();
    for (const s of allScores) if (!s.voided) c.set(s.player_id, (c.get(s.player_id) || 0) + 1);
    return c;
  }, [allScores]);
  const inCurrentEvent = useMemo(() => {
    const s = new Set(entrantIds);
    for (const x of scores) if (!x.voided) s.add(x.player_id);
    return s;
  }, [entrantIds, scores]);

  function flash(t, ms = 4000) { setToast(t); clearTimeout(flash.t); if (ms) flash.t = setTimeout(() => setToast(''), ms); }
  async function run(fn, done) {
    setBusy(true);
    try { const res = await fn(); if (done) flash(typeof done === 'function' ? done(res) : done); return res; }
    catch (e) {
      if (/passcode/i.test(e.message)) { onLogout(); return; }
      flash(/fetch|load failed|network/i.test(e.message) ? '⚠ No connection. Nothing changed. Try again.' : `⚠ ${e.message}`, 7000);
    }
    finally { setBusy(false); }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const mid = machineFilter ? Number(machineFilter) : null;
    return [...scores].sort((a, b) => b.id - a.id).filter(s => {
      if (mid && s.machine_id !== mid) return false;
      if (!q) return true;
      const p = playerById.get(s.player_id), m = machineById.get(s.machine_id);
      return (p?.display_name ?? '').toLowerCase().includes(q) || (m?.name ?? '').toLowerCase().includes(q);
    }).slice(0, 150);
  }, [scores, filter, machineFilter, playerById, machineById]);

  const shownPlayers = useMemo(() => {
    const q = playerFilter.trim().toLowerCase();
    return [...players]
      .filter(p => (playerScope === 'all' || inCurrentEvent.has(p.id)) && (!q || p.display_name.toLowerCase().includes(q)))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [players, playerScope, inCurrentEvent, playerFilter]);

  const open = party?.status === 'open';
  const liveScores = scores.filter(s => !s.voided).length;
  const reviewCount = scores.filter(s => s.needs_review && !s.voided).length;

  return (
    <div className="screen host">
      <div className="row spread">
        <div>
          <h1>Host</h1>
          <div className="muted small">
            {event
              ? `Active event: ${event.name}${event.starts_on ? ' · ' + new Date(`${event.starts_on}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ' · Ongoing'}`
              : 'No event yet'}
          </div>
        </div>
        <button className="ghost" type="button" onClick={onLogout}>Lock</button>
      </div>

      {events.length > 1 && (
        <div className="host-active-bar">
          <span className="muted small">Switch active tournament:</span>
          <select
            value={party?.current_event_id || ''}
            disabled={busy}
            aria-label="Switch active tournament"
            onChange={e => {
              const id = Number(e.target.value);
              const ev = events.find(x => x.id === id);
              if (id && id !== party?.current_event_id) {
                run(() => host.setCurrentEvent(id), `${ev?.name || 'Event'} is now the active event.`);
              }
            }}
          >
            {events.map(e => (
              <option key={e.id} value={e.id}>{e.name}{e.id === party?.current_event_id ? ' (★ Active)' : ''}</option>
            ))}
          </select>
        </div>
      )}

      <nav className="host-nav" aria-label="Host sections">
        <a href="#sec-events" className="host-nav-pill">Events ({events.length})</a>
        <a href="#sec-guests" className="host-nav-pill">Guests</a>
        <a href="#sec-party" className="host-nav-pill">Party night</a>
        {reviewCount > 0 && <a href="#sec-review" className="host-nav-pill warn">Review ({reviewCount})</a>}
        <a href="#sec-scores" className="host-nav-pill">Scores ({liveScores})</a>
        <a href="#sec-players" className="host-nav-pill">Players ({inCurrentEvent.size})</a>
        <a href="#sec-lights" className="host-nav-pill">Lights</a>
        <a href="#sec-end" className="host-nav-pill">End of night</a>
        <a href="#sec-setup" className="host-nav-pill">Setup</a>
      </nav>

      <HostEvents run={run} busy={busy} />

      <GuestsCard eventId={party?.current_event_id} eventName={event?.name} />

      <h2 id="sec-party" className="host-section">Party night</h2>

      <div className="host-grid-2">
        <section className="card">
          <h2>Scores are {open ? 'ON' : 'OFF'}</h2>
          <p className="muted small">{open ? 'Guests can log scores right now.' : "Guests can't log scores right now."} {liveScores} score{liveScores === 1 ? '' : 's'} so far.</p>
          <button className={open ? 'secondary' : 'primary'} type="button" disabled={busy || !party}
            onClick={() => {
              if (open && !confirm('Stop accepting scores? Guests will see that scoring is closed. You can turn it back on.')) return;
              run(() => host.setStatus(open ? 'closed' : 'open'), open ? 'Scores are OFF.' : 'Scores are ON. Guests can log.');
            }}>
            {open ? 'Stop accepting scores' : 'Start accepting scores'}
          </button>
        </section>

        <section className="card">
          <h2>The TV</h2>
          <p className="muted small">On the TV's web browser, go to <b>{SITE_HOST}/tv</b>. Then click once anywhere on it to turn on the sound.</p>
          <div className="row gap">
            <a className="ghost" href="/tv" target="_blank" rel="noreferrer">Open TV board ↗</a>
            <a className="ghost" href="/host/qr" target="_blank" rel="noreferrer">Print machine QR codes ↗</a>
            <a className="ghost" href="/lights-sim" target="_blank" rel="noreferrer">Lights simulator ↗</a>
          </div>
        </section>
      </div>

      <LightsPanel busy={busy} run={run} />

      <ReviewQueue scores={scores} playerById={playerById} machineById={machineById} busy={busy} run={run} />

      <AddScore players={players} machines={machines} busy={busy} run={run} />

      <section id="sec-scores" className="card">
        <div className="host-card-head">
          <div>
            <h2>All scores ({shown.length})</h2>
            <p className="muted small">Wrong or fake score? Tap Remove. You can undo that with Restore.</p>
          </div>
          <div className="host-filter-bar">
            <select className="host-select" value={machineFilter} onChange={e => setMachineFilter(e.target.value)} aria-label="Filter by machine">
              <option value="">All machines</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input className="host-filter" value={filter} onChange={e => setFilter(e.target.value)} placeholder="search name or machine" />
          </div>
        </div>
        <div className="table-wrap host-scroll-box">
          <table className="host-table">
            <thead><tr><th>When</th><th>Player</th><th>Machine</th><th className="ralign">Score</th><th className="ralign">Action</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={5} className="muted">No scores match.</td></tr>}
              {shown.map(s => {
                const p = playerById.get(s.player_id);
                return (
                  <tr key={s.id} className={s.voided ? 'voided' : ''}>
                    <td className="muted small">{new Date(s.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
                    <td>{p?.emoji ? <PixelEmoji e={p.emoji} size={16} /> : null} {p?.display_name ?? '?'}{s.logged_by ? <span className="muted small host-logged-by">logged by {playerById.get(s.logged_by)?.display_name ?? '?'}</span> : null}</td>
                    <td>{machineById.get(s.machine_id)?.name}{s.photo_path ? <> <a href={photoUrl(s.photo_path)} target="_blank" rel="noreferrer" title="photo of the score"><PixelEmoji e="📸" size={22} /></a></> : null}</td>
                    <td className="ralign mono">{fmt(s.value)}</td>
                    <td className="ralign">
                      {s.voided
                        ? <button className="ghost" type="button" disabled={busy} onClick={() => run(() => host.voidScore(s.id, false), 'Score restored.')}>Restore</button>
                        : <button className="ghost danger" type="button" disabled={busy} onClick={() => run(() => host.voidScore(s.id, true), `Removed ${p?.display_name ?? ''}'s ${fmt(s.value)}. Tap Restore to undo.`)}>Remove</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section id="sec-players" className="card">
        <div className="host-card-head">
          <div>
            <h2>Players ({shownPlayers.length})</h2>
            <p className="muted small">
              Player accounts are permanent across all events (nickname, 8-bit portrait, and PIN carry over).
              Someone forgot their PIN? Tap Reset PIN.
            </p>
          </div>
          <div className="host-filter-bar">
            <button type="button" className={playerScope === 'event' ? 'primary' : 'ghost'} onClick={() => setPlayerScope('event')}>
              Active event ({inCurrentEvent.size})
            </button>
            <button type="button" className={playerScope === 'all' ? 'primary' : 'ghost'} onClick={() => setPlayerScope('all')}>
              All accounts ({players.length})
            </button>
            <input className="host-filter" value={playerFilter} onChange={e => setPlayerFilter(e.target.value)} placeholder="search players…" />
          </div>
        </div>
        {players.some(p => p.avatar?.startsWith('data:image/jpeg')) && (
          <button className="ghost" type="button" disabled={busy} onClick={() => run(async () => {
            const todo = players.filter(p => p.avatar?.startsWith('data:image/jpeg'));
            let ok = 0;
            for (let i = 0; i < todo.length; i += 3) {
              flash(`Drawing ${i + 1}–${Math.min(i + 3, todo.length)} of ${todo.length}…`, 0);
              const r = await Promise.allSettled(todo.slice(i, i + 3).map(p => hostPixelize(p.id)));
              ok += r.filter(x => x.status === 'fulfilled').length;
            }
            return ok;
          }, ok => `8-bit portraits: ${ok} done.`)}>Turn selfies into 8-bit portraits</button>
        )}
        <div className="host-players host-scroll-box">
          {shownPlayers.map(p => {
            const n = plays.get(p.id) || 0;
            const tot = allPlays.get(p.id) || 0;
            const inEv = inCurrentEvent.has(p.id);
            return (
              <div key={p.id} className="host-player">
                <div className="host-player-who">
                  <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={28} />
                  <div className="host-player-info">
                    <span className="grow">
                      {p.display_name}
                      {p.first_timer && <span className="player-ft">NEW</span>}
                    </span>
                    <span className="muted small">
                      {n} game{n === 1 ? '' : 's'}{tot > n ? ` (${tot} all-time)` : ''}
                      {playerScope === 'all' && !inEv ? ' · not in active event' : ''}
                    </span>
                  </div>
                </div>
                <div className="host-player-actions">
                  {playerScope === 'all' && !inEv && party?.current_event_id && (
                    <button className="ghost" type="button" disabled={busy} onClick={() => run(() => host.setEntry(party.current_event_id, p.id, true), `Added ${p.display_name} to ${event?.name || 'event'}.`)}>
                      + Add to event
                    </button>
                  )}
                  <button className="ghost" type="button" disabled={busy} onClick={() => {
                    const pin = prompt(`New 4-digit PIN for ${p.display_name} (numbers only):`);
                    if (pin == null) return;
                    if (!/^\d{4}$/.test(pin.trim())) { flash('⚠ The PIN has to be exactly 4 numbers.'); return; }
                    run(() => host.resetPin(p.id, pin.trim()), `PIN reset. Tell ${p.display_name} their new PIN is ${pin.trim()}.`);
                  }}>Reset PIN</button>
                  <button className="ghost danger" type="button" disabled={busy} onClick={() => {
                    if (!confirm(`Delete permanent account "${p.display_name}"${tot ? ` and all ${tot} of their score${tot === 1 ? '' : 's'} across every event` : ''}? This can't be undone.`)) return;
                    run(() => host.removePlayer(p.id), `${p.display_name} removed.`);
                  }}>Remove</button>
                </div>
              </div>
            );
          })}
          {shownPlayers.length === 0 && <div className="muted small">No matching players.</div>}
        </div>
      </section>

      <h2 id="sec-end" className="host-section">End of the night</h2>
      <EndOfNight party={party} event={event} open={open} busy={busy} run={run} />

      <h2 id="sec-setup" className="host-section">Setup (before the party)</h2>
      <section className="card">
        <h2>Scanner setup</h2>
        <p className="muted small">Technical: tests the score camera on each machine. Matt's job.</p>
        <Link className="ghost" to="/host/test">Open scanner setup</Link>
      </section>
      <CleanupCard players={players} scores={scores} event={event} busy={busy} run={run} />

      {toast && <div className={`host-toast${toast.startsWith('⚠') ? ' err' : ''}`} onClick={() => setToast('')}>{toast}</div>}
    </div>
  );
}

// Big obvious way into the guest list, with the numbers that matter.
function GuestsCard({ eventId, eventName }) {
  const [g, setG] = useState(null);
  useEffect(() => { if (eventId) host.invites(eventId).then(setG).catch(() => setG(null)); }, [eventId]);
  const paid = g?.filter(x => x.paid).length ?? 0;
  const unsent = g?.filter(x => (x.paid ? !x.register_sent_at : !x.invited_at)).length ?? 0;
  const joined = g?.filter(x => x.player_id).length ?? 0;
  return (
    <Link id="sec-guests" to={`/host/guests${eventId ? `?event=${eventId}` : ''}`} className="card host-guests-card">
      <div>
        <h2>Guest list &amp; emails{eventName ? ` (${eventName})` : ''} →</h2>
        <div className="muted small">
          {g ? `${g.length} guests · ${paid} paid · ${joined} signed up${unsent ? ` · ${unsent} not emailed yet` : ''}` : 'Contact info, paid, RSVPs, invites and updates'}
        </div>
      </div>
    </Link>
  );
}

// During the reveal: step through the prizes. Each Next shows the next prize's name and a 3-2-1 on
// the TV, then the winner, and the TV waits there.
function RevealControls({ party, busy, run }) {
  const { standings } = useStandings();
  const awards = useAwards(standings, party?.match_digits ?? null);
  const plan = revealPlan({ standings, awards });
  const step = Math.min(party?.reveal_step || 0, Math.max(0, plan.length - 1));
  const cur = plan[step], next = plan[step + 1];
  return (
    <div className="reveal-controls">
      <div className="muted small">Prize {step + 1} of {plan.length}{cur ? `: ${cur.label}, ${cur.title}` : ''}</div>
      <div className="row gap">
        <button className="secondary" type="button" disabled={busy || step === 0} onClick={() => run(() => host.revealStep(step - 1), 'Back one prize.')}>◀ Back</button>
        <button className="primary" type="button" disabled={busy || !next} onClick={() => run(() => host.revealStep(step + 1), `Next: ${next.label}.`)}>{next ? `Next prize: ${next.label} ▶` : 'That was the last prize'}</button>
      </div>
      <div className="muted small">On the TV Mac you can also click, or press Space or the arrow keys.</div>
    </div>
  );
}

function EndOfNight({ party, event, open, busy, run }) {
  const [matchDigits, setMatchDigits] = useState('');
  const revealing = !!party?.reveal_active;
  return (
    <section className="card">
      <ol className="host-steps">
        <li className={open ? '' : 'done'}>
          <b>Stop scores.</b> {open
            ? <button className="secondary" type="button" disabled={busy} onClick={() => run(() => host.setStatus('closed'), 'Scores are OFF.')}>Stop accepting scores</button>
            : <span className="muted small">Done: scores are off.</span>}
        </li>
        <li>
          <b>Reveal the winners on the TV.</b>
          <label className="field">
            <span>The Match (optional): someone draws a number from 00 to 99. The score whose last two digits are closest to it wins.</span>
            <input type="number" min="0" max="99" value={matchDigits} onChange={e => setMatchDigits(e.target.value)} placeholder="e.g. 42" />
          </label>
          {!revealing ? (
            <button className="primary big" type="button" disabled={busy} onClick={() => {
              if (open && !confirm('Scores are still ON. Stop scores and start the reveal?')) return;
              run(async () => {
                if (open) await host.setStatus('closed');
                await host.reveal(true, matchDigits === '' ? null : Number(matchDigits));
              }, 'The reveal is playing on the TV.');
            }}>🎉 Start the reveal</button>
          ) : (
            <>
              <RevealControls party={party} busy={busy} run={run} />
              <button className="secondary big" type="button" disabled={busy} onClick={() => run(() => host.reveal(false), 'TV is back to the leaderboard.')}>End the reveal</button>
            </>
          )}
        </li>
        <li>
          <b>Email everyone their results.</b> <span className="muted small">Only players who ticked "email me results" get one.</span>
          {event?.results_sent_at && <div className="muted small">Already sent {new Date(event.results_sent_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.</div>}
          <div className="row gap" style={{ marginTop: 8 }}>
            <button className="ghost" type="button" disabled={busy || open || !event} onClick={() => {
              if (event.results_sent_at && !confirm('Results were ALREADY emailed once. Send them again to everyone?')) return;
              if (!event.results_sent_at && !confirm('Email final results now to every player who asked for them?')) return;
              run(() => emailResults(event.id), r => `Results emailed to ${r?.sent ?? 0} player${r?.sent === 1 ? '' : 's'}${r?.skipped ? ` (${r.skipped} didn't want email)` : ''}.`);
            }}>{open ? 'Stop scores first' : 'Email results'}</button>
            <button className="ghost" type="button" disabled={busy || !event} onClick={() => {
              const to = prompt('Send a sample to which email? (Uses the current #1 player\'s results. No guest gets anything.)');
              if (!to?.trim()) return;
              run(() => emailResults(event.id, { testTo: to.trim() }), `Sample sent to ${to.trim()}.`);
            }}>Send me a sample</button>
          </div>
        </li>
      </ol>
    </section>
  );
}

// Scores that deserve a second look: a new #1 with no photo, or a score logged for someone else.
function ReviewQueue({ scores, playerById, machineById, busy, run }) {
  const queue = scores.filter(s => s.needs_review && !s.voided).sort((a, b) => b.id - a.id);
  if (!queue.length) return null;
  return (
    <section id="sec-review" className="card review-card">
      <div className="host-card-head">
        <div>
          <h2>Double-check these ({queue.length})</h2>
          <p className="muted small">New #1 scores with no photo, or scores someone logged for a friend. Looks right? Tap OK.</p>
        </div>
        {queue.length > 1 && (
          <button
            className="ghost"
            type="button"
            disabled={busy}
            onClick={() => run(async () => {
              for (const s of queue) await host.markReviewed(s.id);
            }, `Marked all ${queue.length} scores OK.`)}
          >
            OK all ({queue.length})
          </button>
        )}
      </div>
      <div className="review-list host-scroll-box">
        {queue.map(s => {
          const p = playerById.get(s.player_id);
          return (
            <div key={s.id} className="host-player">
              <div className="host-player-who">
                <Avatar avatar={p?.avatar} emoji={p?.emoji} name={p?.display_name} color={p?.color} size={28} />
                <span className="grow">
                  <strong>{p?.display_name ?? '?'}</strong> · {machineById.get(s.machine_id)?.name} · <span className="mono">{fmt(s.value)}</span>
                  {s.logged_by ? <span className="muted small"> · logged by {playerById.get(s.logged_by)?.display_name ?? '?'}</span> : null}
                  {s.photo_path ? <> · <a className="link" href={photoUrl(s.photo_path)} target="_blank" rel="noreferrer">photo</a></> : null}
                </span>
              </div>
              <div className="host-player-actions">
                <button className="ghost" type="button" disabled={busy} onClick={() => run(() => host.markReviewed(s.id), 'Marked OK.')}>OK</button>
                <button className="ghost danger" type="button" disabled={busy} onClick={() => run(() => host.voidScore(s.id, true), 'Score removed.')}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>
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
      <h2>Add or fix a score</h2>
      <p className="muted small">Phone died? Add it here. Wrong number? Remove it in "All scores" below, then add the right one here.</p>
      <div className="host-add">
        <select value={pid} onChange={e => setPid(e.target.value)} aria-label="Player">
          <option value="">Player…</option>
          {[...players].sort((a, b) => a.display_name.localeCompare(b.display_name)).map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
        <select value={mid} onChange={e => setMid(e.target.value)} aria-label="Machine">
          <option value="">Machine…</option>
          {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input inputMode="numeric" value={val} onChange={e => setVal(e.target.value.replace(/\D/g, ''))} placeholder="score" aria-label="Score" />
        <button className="primary" type="button" disabled={busy || !ok}
          onClick={() => run(async () => { await host.addScore(Number(pid), Number(mid), Number(val)); setVal(''); }, 'Score added.')}>Add</button>
      </div>
    </section>
  );
}

// Before the party: clear test scores for the active event but keep everyone who already signed up and past events.
function CleanupCard({ players, scores, event, busy, run }) {
  const [txt, setTxt] = useState('');
  const [wipe, setWipe] = useState('');
  return (
    <section className="card danger-card">
      <h2>Clear test scores ({event?.name || 'active event'})</h2>
      <p className="muted small">Deletes all {scores.length} score{scores.length === 1 ? '' : 's'} in <b>{event?.name || 'this event'}</b> so the tournament starts at zero. Past events, permanent player accounts, the guest list, and emails are all kept. Type CLEAR to confirm.</p>
      <div className="row gap">
        <input value={txt} onChange={e => setTxt(e.target.value.toUpperCase())} placeholder="CLEAR" />
        <button className="ghost danger" type="button" disabled={busy || txt !== 'CLEAR'}
          onClick={() => run(async () => { const n = await host.clearScores(txt); setTxt(''); return n; }, n => `Cleared ${n ?? 0} scores. Players kept.`)}>Clear scores</button>
      </div>
      <details className="host-advanced">
        <summary>Emergency: erase everything</summary>
        <p className="muted small">Deletes all {players.length} players (including real guests who already signed up: they'd have to sign up again) and all scores. Only for starting completely over. Type WIPE.</p>
        <div className="row gap">
          <input value={wipe} onChange={e => setWipe(e.target.value.toUpperCase())} placeholder="WIPE" />
          <button className="ghost danger" type="button" disabled={busy || wipe !== 'WIPE'}
            onClick={() => { if (confirm(`Really delete all ${players.length} players and every score?`)) run(async () => { await host.wipe(wipe); setWipe(''); }, 'Everything erased.'); }}>Erase everything</button>
        </div>
      </details>
    </section>
  );
}
