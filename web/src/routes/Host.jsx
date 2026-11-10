import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { currentEventData, getHostPass, getState, host, loadAwardsSnap, photoUrl, refreshAll, setHostPass, useParty, usePhase, useRevealData } from '../lib/store.js';
import { fromSnapshot, makeSnapshot, planChanges } from '../lib/awardsSnapshot.js';
import { stepName, tvStatus, tvStatusText } from '../lib/tvStatus.js';
import { fmtClock, isoToPacific, pacificToIso, revealedAfterEnd } from '../lib/schedule.js';
import { serverNow } from '../lib/clock.js';
import { FINALE_STEP, PRIZE_COUNT, revealPlan } from '../components/Reveal.jsx';
import { fmt } from '../lib/scoring.js';
import { emailResults } from '../lib/emailResults.js';
import Avatar from '../components/Avatar.jsx';
import PixelEmoji from '../components/PixelEmoji.jsx';
import { hostPixelize } from '../lib/pixelAvatar.js';
import HostEvents from '../components/HostEvents.jsx';
import LightsPanel from '../components/LightsPanel.jsx';
import AudioPanel from '../components/AudioPanel.jsx';
import HostAccess from '../components/HostAccess.jsx';

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
  const freePlays = useMemo(() => {
    const c = new Map();
    for (const s of scores) if (!s.voided && s.free_play) c.set(s.player_id, (c.get(s.player_id) || 0) + 1);
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
      flash(/fetch|load failed|network|timed? ?out|abort/i.test(e.message) ? '⚠ No connection (or it timed out). Tap again: it\'s safe to retry.' : `⚠ ${e.message}`, 7000);
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
  const phase = usePhase();
  const liveScores = scores.filter(s => !s.voided).length;
  const reviewCount = scores.filter(s => s.needs_review && !s.voided && !s.free_play).length;
  const reveal = useRevealHost(party, run);

  return (
    <div className={`screen host${party?.reveal_active ? ' host-revealing' : ''}`}>
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
                if (!confirm(`Make "${ev?.name || 'that event'}" the active event? Every phone and the TV switch to it right away.`)) { e.target.value = String(party?.current_event_id || ''); return; }
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
        <a href="#sec-access" className="host-nav-pill">Access</a>
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

      <HostAccess run={run} busy={busy} />

      <h2 id="sec-party" className="host-section">Party night</h2>

      <div className="host-grid-2">
        <section className="card">
          <h2>Scores are {open ? 'ON' : 'OFF'}{open && phase !== 'on' ? ' (free play)' : ''}</h2>
          <p className="muted small">{!open ? "Guests can't log scores right now." : phase === 'on' ? 'Guests can log scores right now, and they count.' : "Guests can log scores just for fun: they don't count for the tournament."} {liveScores} score{liveScores === 1 ? '' : 's'} so far.</p>
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
      <AudioPanel />

      <ReviewQueue scores={scores} playerById={playerById} machineById={machineById} busy={busy} run={run} />

      <AddScore players={players} machines={machines} busy={busy} run={run} />

      <AddPlayer busy={busy} run={run} />

      <section id="sec-scores" className="card">
        <div className="host-card-head">
          <div>
            <h2>All scores ({shown.length})</h2>
            <p className="muted small">Wrong or fake score? Tap Remove. You can undo that with Restore. The Counts / Free play button flips whether a score counts for the tournament.</p>
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
                    <td className="ralign host-score-actions">
                      <button className={`ghost${s.free_play ? ' kind-fp' : ''}`} type="button" disabled={busy || s.voided}
                        title="Tap to flip between counting for the tournament and free play"
                        onClick={() => run(() => host.setScoreKind(s.id, !!s.free_play), s.free_play ? `${p?.display_name ?? ''}'s ${fmt(s.value)} now counts for the tournament.` : `${p?.display_name ?? ''}'s ${fmt(s.value)} is now free play (doesn't count).`)}>
                        {s.free_play ? 'Free play' : 'Counts'}
                      </button>
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
              Someone forgot their PIN? Tap Reset PIN. Rude or confusing nickname? Tap Rename.
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
            const fp = freePlays.get(p.id) || 0;
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
                      {n} game{n === 1 ? '' : 's'}{fp ? ` (${n - fp} count, ${fp} free play)` : ''}{tot > n ? ` · ${tot} all-time` : ''}
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
                    const name = prompt(`New nickname for ${p.display_name} (up to 24 characters):`, p.display_name);
                    if (name == null || !name.trim() || name.trim() === p.display_name) return;
                    run(() => host.renamePlayer(p.id, name.trim()), `Renamed to ${name.trim()}.`);
                  }}>Rename</button>
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

      <ScheduleCard party={party} phase={phase} busy={busy} run={run} />

      <h2 id="sec-end" className="host-section">End of the night</h2>
      <EndOfNight party={party} event={event} phase={phase} reviewCount={reviewCount} busy={busy} run={run} reveal={reveal} flash={flash} />

      <h2 id="sec-setup" className="host-section">Setup (before the party)</h2>
      <section className="card">
        <h2>Scanner setup</h2>
        <p className="muted small">Technical: tests the score camera on each machine. Matt's job.</p>
        <Link className="ghost" to="/host/test">Open scanner setup</Link>
      </section>
      <CleanupCard players={players} scores={scores} event={event} busy={busy} run={run} />

      {party?.reveal_active && <RevealBar reveal={reveal} busy={busy} run={run} />}
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

// The reveal on the host page: the plan (from the awards snapshot once the reveal has started), the
// current step (optimistic: the next press uses the step we just asked for), and the TV's heartbeat.
function useRevealHost(party, run) {
  const rv = useRevealData();
  const plan = useMemo(() => revealPlan({ standings: rv.standings, awards: rv.awards }), [rv.standings, rv.awards]);
  const livePlan = useMemo(
    () => (rv.frozen ? revealPlan({ standings: rv.live.standings, awards: rv.live.awards }) : plan),
    [rv.frozen, rv.live.standings, rv.live.awards, plan],
  );
  const changes = useMemo(() => (rv.frozen ? planChanges(plan, livePlan) : []), [rv.frozen, plan, livePlan]);
  const [asked, setAsked] = useState(null);
  useEffect(() => { setAsked(null); }, [party?.reveal_step]);
  const step = Math.min(asked ?? party?.reveal_step ?? 0, Math.max(0, plan.length - 1));
  // host_reveal_step sets an absolute step, so a retried tap can't skip a prize.
  const goTo = (n, msg) => { setAsked(n); run(() => host.revealStep(n).catch(e => { setAsked(null); throw e; }), msg); };
  const tv = useTvStatus(!!party?.reveal_active, party?.reveal_step ?? 0);
  return { rv, plan, livePlan, changes, step, goTo, tv };
}

// The TV's heartbeat, read every 3 s while the reveal is on (host page only).
function useTvStatus(active, partyStep) {
  const [row, setRow] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const read = () => host.tvStatus().then(r => { if (alive) setRow(r); }).catch(() => {});
    read();
    const iv = setInterval(read, 3000);
    const t = setInterval(() => tick(x => x + 1), 1000);
    return () => { alive = false; clearInterval(iv); clearInterval(t); };
  }, [active]);
  return tvStatus(row, serverNow(), partyStep);
}

const stepTitle = (s, i) => (!s ? '' : s.kind === 'intro' ? 'Intro: Awards ceremony' : s.kind === 'finale' ? 'Finale: all the winners' : `${i}/${PRIZE_COUNT} ${s.label}`);

// Sticky at the bottom of the host page while the reveal is on: Back / Next, what's on the TV now, and
// who wins next (host-only screen). Back shows the previous winner straight away; Next plays the full
// build-up. On the finale, Next becomes "Start free play".
function RevealBar({ reveal, busy, run }) {
  const { plan, step, goTo, tv } = reveal;
  const cur = plan[step], next = plan[step + 1];
  const finale = cur?.kind === 'finale';
  return (
    <div className="host-reveal-bar" role="region" aria-label="Reveal controls">
      <div className="hrb-text">
        <div className="hrb-now">{stepTitle(cur, step)}{cur?.winner ? ` · ${cur.winner}` : ''}</div>
        <div className="hrb-next">{next ? `Next: ${next.kind === 'finale' ? 'the finale' : next.label}${next.winner ? ` → ${next.winner}` : next.kind === 'prize' ? ' → no winner' : ''}` : 'Last slide: start free play when you\'re ready'}</div>
      </div>
      <div className="hrb-row">
        <button className="secondary" type="button" disabled={busy || step === 0} onClick={() => goTo(step - 1, `Back to ${stepName(step - 1)}.`)}>◀ Back</button>
        <div className={`hrb-tv${tv.ok && !tv.behind && tv.mode === 'reveal' ? ' tv-good' : ' tv-bad'}`}>{tvStatusText(tv, PRIZE_COUNT)}</div>
        {finale
          ? <button className="primary" type="button" disabled={busy} onClick={() => run(() => host.freePlay(true), 'Free play is on. The TV shows the high score board.')}>Start free play ▶</button>
          : <button className="primary" type="button" disabled={busy || !next} onClick={() => goTo(step + 1, `Next: ${next?.label ?? ''}.`)}>Next ▶</button>}
      </div>
    </div>
  );
}

// In the End of night card while the reveal is on: the whole plan (all 14 slides with winner names),
// the TV's heartbeat, when the prizes were saved, and anything the live scores would change.
function RevealPlanCard({ reveal, party, busy, run }) {
  const { plan, step, tv, rv, changes } = reveal;
  const recompute = () => {
    if (!confirm(`Recompute every prize from the latest scores?${changes.length ? `\n\nThis changes:\n${changes.map(c => `• ${c.label}: ${c.saved || 'no winner'} → ${c.live || 'no winner'}`).join('\n')}` : '\n\nRight now nothing would change.'}\n\nThe TV switches to the new results right away.`)) return;
    run(async () => {
      await refreshAll();
      const d = currentEventData();
      await host.saveAwards(makeSnapshot({ ...d, matchDigits: getState().party?.match_digits ?? null }), true);
    }, 'Prizes recomputed from the latest scores. The TV uses them now.');
  };
  return (
    <div className="reveal-controls">
      <div className={`hrb-tv${tv.ok && !tv.behind && tv.mode === 'reveal' ? ' tv-good' : ' tv-bad'}`}>{tvStatusText(tv, PRIZE_COUNT)}</div>
      <div className="muted small">
        {rv.frozen ? `Prizes saved at ${fmtClock(rv.frozen.savedAt)}: late scores and fixes don't change them.` : 'Prizes follow the live scores (no saved snapshot).'}
        {' '}Use the bar at the bottom: Back / Next. On the TV Mac: Shift + arrow keys.
      </div>
      {changes.length > 0 && (
        <div className="host-plan-warn">
          ⚠ The live scores now give a different result for {changes.map(c => `${c.label} (${c.live || 'no winner'})`).join(', ')}. Tap Recompute prizes only if that's a real fix.
        </div>
      )}
      <ol className="host-plan">
        {plan.map((s, i) => (
          <li key={i} className={`${i === step ? 'on' : i < step ? 'done' : ''}${changes.some(c => c.step === i) ? ' changed' : ''}`}>
            <span className="hp-n">{s.kind === 'intro' ? 'Intro' : s.kind === 'finale' ? 'End' : i}</span>
            <span className="hp-label">{s.kind === 'finale' ? 'Finale · group photo' : s.label}</span>
            <span className="hp-who">{s.kind === 'prize' ? (s.winner || 'no winner') : ''}{s.tie ? <small>{s.tie}</small> : null}</span>
          </li>
        ))}
      </ol>
      <div className="row gap">
        <button className="ghost" type="button" disabled={busy || !party} onClick={recompute}>Recompute prizes</button>
      </div>
    </div>
  );
}

const PHASE_TEXT = {
  pre: 'Free play: the tournament hasn\'t started yet',
  on: 'Tournament on: scores count',
  closed: 'Scores are off',
  grace: 'Play is over: scores logged in the next few minutes still count',
  over: 'Tournament over: results sealed until the reveal; new scores are free play',
  reveal: 'The reveal is on the TV',
  free: 'Free play: just for fun',
};

// Tournament start and end times. Before the start and after the end, scores are free play (the
// database decides from its own clock). The TV counts down to both.
function ScheduleCard({ party, phase, busy, run }) {
  const startsAt = party?.tourney_starts_at || null, endsAt = party?.tourney_ends_at || null;
  const [start, setStart] = useState(isoToPacific(startsAt));
  const [end, setEnd] = useState(isoToPacific(endsAt));
  useEffect(() => { setStart(isoToPacific(startsAt)); }, [startsAt]);
  useEffect(() => { setEnd(isoToPacific(endsAt)); }, [endsAt]);
  const dirty = start !== isoToPacific(startsAt) || end !== isoToPacific(endsAt);
  const nowIso = () => new Date(serverNow()).toISOString();
  const save = (s, e, msg) => run(() => host.setSchedule(s, e), msg);
  return (
    <section className="card host-sched">
      <h2>Tournament times</h2>
      <p className="muted small">
        Now: <b>{PHASE_TEXT[phase] || phase}</b>.
        {startsAt || endsAt
          ? ` The tournament runs ${startsAt ? `from ${fmtClock(startsAt)}` : 'from now'}${endsAt ? ` to ${fmtClock(endsAt)}` : ' until you stop it'}. Scores before or after that are free play and don't count. The TV counts down to both.`
          : ' No times set: the tournament runs whenever scores are on. Set times to start and end it automatically, with countdowns on the TV.'}
      </p>
      <div className="host-sched-fields">
        <label className="field">
          <span className="muted small">Starts (Pacific time)</span>
          <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span className="muted small">Ends (Pacific time)</span>
          <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} disabled={busy} />
        </label>
      </div>
      <div className="row gap host-sched-row">
        <button className="primary" type="button" disabled={busy || !dirty} onClick={() => {
          const s = pacificToIso(start), e = pacificToIso(end);
          if (s && e && Date.parse(e) <= Date.parse(s)) { alert('The end time has to be after the start time.'); return; }
          save(s, e, s || e ? `Saved: ${s ? fmtClock(s) : 'now'} to ${e ? fmtClock(e) : 'whenever you stop it'}.` : 'Times cleared.');
        }}>Save times</button>
        <button className="ghost" type="button" disabled={busy || (!startsAt && !endsAt)} onClick={() => {
          if (!confirm('Clear both times? The TV countdowns stop, and the tournament runs whenever scores are on.')) return;
          save(null, null, 'Times cleared.');
        }}>Clear times</button>
      </div>
      <div className="muted small">Running late or early?</div>
      <div className="row gap host-sched-row">
        <button className="ghost" type="button" disabled={busy || phase !== 'pre'} onClick={() => {
          if (!confirm('Start the tournament now? Scores count from now on.')) return;
          save(nowIso(), endsAt, 'The tournament is on.');
        }}>Start now</button>
        <button className="ghost" type="button" disabled={busy || !endsAt || !['on', 'grace', 'over'].includes(phase) || revealedAfterEnd(party)} onClick={() => {
          save(startsAt, new Date(Date.parse(endsAt) + 15 * 60000).toISOString(), `Ends at ${fmtClock(new Date(Date.parse(endsAt) + 15 * 60000).toISOString())} now.`);
        }}>+15 min</button>
        <button className="ghost" type="button" disabled={busy || phase !== 'on'} onClick={() => {
          if (!confirm('End the tournament now? Scores logged from now on are free play and don\'t count.')) return;
          save(startsAt && Date.parse(startsAt) < serverNow() ? startsAt : null, nowIso(), 'The tournament is over.');
        }}>End now</button>
      </div>
    </section>
  );
}

// Start the reveal: freeze the awards (snapshot) first, then switch the TV over. A snapshot saved
// earlier (a restart mid-ceremony, or a rehearsal) is kept when the latest scores give the same prizes;
// if they'd change anything, the host chooses.
async function startReveal({ running, stopTournament, flash }) {
  if (running) await stopTournament();
  await refreshAll();
  await loadAwardsSnap();
  const st = getState();
  const savedRow = st.awardsSnap?.event_id === st.party?.current_event_id ? st.awardsSnap : null;
  const saved = savedRow?.snapshot || null;
  // Draw once: starting the reveal again keeps the same number, so The Match winner never changes.
  const drawn = saved?.match_digits ?? st.party?.match_digits ?? (crypto.getRandomValues(new Uint32Array(1))[0] % 10) * 10; // 00, 10 … 90
  const fresh = makeSnapshot({ ...currentEventData(), matchDigits: drawn });
  let keep = false;
  if (saved) {
    const ctx = { allMachines: st.allMachines, allPlayers: st.players, liveScores: st.scores };
    const a = fromSnapshot(saved, ctx), b = fromSnapshot(fresh, ctx);
    const ch = a && b ? planChanges(revealPlan(a), revealPlan(b)) : [{ label: '?' }];
    keep = !ch.length || !confirm(`Prizes were saved at ${fmtClock(saved.saved_at)}. With the latest scores ${ch.length} prize${ch.length === 1 ? '' : 's'} change${ch.length === 1 ? 's' : ''}:\n${ch.map(c => `• ${c.label}: ${c.saved || 'no winner'} → ${c.live || 'no winner'}`).join('\n')}\n\nOK = use the latest scores (normal). Cancel = keep the saved prizes.`);
  }
  if (!keep) {
    try { await host.saveAwards(fresh, true); }
    catch (e) {
      // Before migration 0040 the reveal still works, just from live scores.
      if (!/could not find the function|schema cache|does not exist/i.test(e.message)) throw e;
      flash?.('⚠ Prizes not frozen (server update missing): the reveal follows live scores.', 7000);
    }
  }
  await host.reveal(true, drawn);
}

function EndOfNight({ party, event, phase, reviewCount = 0, busy, run, reveal, flash }) {
  const revealing = !!party?.reveal_active;
  const freePlay = !!party?.free_play;
  const isOpen = party?.status === 'open';
  const running = phase === 'on' || phase === 'pre';
  const endsAt = party?.tourney_ends_at || null;
  // End the tournament by setting its end to now: logging and sign-ups stay open (as free play).
  const stopTournament = () => host.setSchedule(party?.tourney_starts_at && Date.parse(party.tourney_starts_at) < serverNow() ? party.tourney_starts_at : null, new Date(serverNow()).toISOString());
  return (
    <section className="card">
      <ol className="host-steps">
        <li className={running ? '' : 'done'}>
          <b>End the tournament.</b> {running
            ? (endsAt
              ? <span className="muted small">It ends by itself at {fmtClock(endsAt)} (the TV counts down). Or end it now in Tournament times above.</span>
              : <button className="secondary" type="button" disabled={busy} onClick={() => {
                if (!confirm('End the tournament now? Guests can keep logging, but new scores are free play and don\'t count.')) return;
                run(stopTournament, 'The tournament is over.');
              }}>End the tournament now</button>)
            : phase === 'grace'
            ? <span className="muted small">Play is over. Scores logged in the next few minutes still count.</span>
            : <span className="muted small">Done: tournament scores are final.</span>}
        </li>
        <li>
          <b>Reveal the winners on the TV.</b>
          <div className="muted small">Until you start, the TV shows "The results are in · awards soon" (results sealed). Starting saves the prizes (late scores can't change them), fades the music and opens on "Awards ceremony". Press Next (bottom bar) for each prize: Grand Champion first, The Match last (it draws 00–90 and spins). The podium needs 3+ machines played. The finale shows every winner: group photo, then Start free play.</div>
          {!revealing ? (
            <button className="primary big" type="button" disabled={busy} onClick={() => {
              if (reviewCount && !confirm(`${reviewCount} score${reviewCount === 1 ? '' : 's'} still need${reviewCount === 1 ? 's' : ''} a look (see "Double-check these" above). Start the reveal anyway?`)) return;
              if (running && !confirm('The tournament is still running. End it and start the reveal?')) return;
              if (phase === 'grace' && !confirm('Guests can still log their last scores for a couple of minutes. Start the reveal anyway?')) return;
              if (!running && freePlay && !confirm('Free play is on. Start the reveal again? The TV switches to the reveal; free play comes back when you end it.')) return;
              run(() => startReveal({ running, stopTournament, flash }), 'The reveal is on the TV: the intro waits for Next (bottom bar).');
            }}>🎉 Start the reveal</button>
          ) : (
            <>
              <RevealPlanCard reveal={reveal} party={party} busy={busy} run={run} />
              <button className="secondary big" type="button" disabled={busy} onClick={() => {
                if (!confirm('End the reveal? The TV goes back to the leaderboard (starting again begins at the first prize).')) return;
                run(() => host.reveal(false), 'TV is back to the leaderboard.');
              }}>End the reveal</button>
            </>
          )}
        </li>
        <li className={freePlay ? 'on' : ''}>
          <b>Free play.</b> <span className="muted small">After the awards (the finale's "Start free play" button does this), guests keep logging scores just for fun and the music comes back. The TV shows each machine's high scores of the night. The tournament results stay final.</span>
          <div className="row gap host-fp-row">
            <span className={`host-pill${freePlay ? ' on' : ''}`}>{freePlay ? `On since ${fmtClock(party?.free_play_at)}` : 'Off'}</span>
            {freePlay ? (
              <button className="secondary" type="button" disabled={busy} onClick={() => {
                if (!confirm('End free play? Guests can\'t log scores any more.')) return;
                run(() => host.freePlay(false), 'Free play is over. Scores are OFF.');
              }}>End free play</button>
            ) : (
              <button className="primary" type="button" disabled={busy} onClick={() => {
                const msg = running
                  ? 'The tournament is still running! Start free play anyway? That ends the tournament: scores from now on don\'t count.'
                  : `Start free play?${revealing ? ' This ends the reveal.' : ''} The TV switches to the high score board and guests can log scores again, just for fun.`;
                if (!confirm(msg)) return;
                run(async () => { if (running && endsAt) await stopTournament(); await host.freePlay(true); }, 'Free play is on.');
              }}>Start free play</button>
            )}
          </div>
        </li>
        <li className={isOpen ? '' : 'done'}>
          <b>Close the party.</b> <span className="muted small">At the very end of the night. Stops free play, new sign-ups and score logging. Everything stays up: the TV shows the final results, and Ranks and Me keep tonight's winners.</span>
          <div className="row gap host-fp-row">
            <span className={`host-pill${isOpen ? ' on' : ''}`}>{isOpen ? 'Open' : 'Closed'}</span>
            {isOpen ? (
              <button className="secondary" type="button" disabled={busy || !party} onClick={() => {
                if (!confirm('Close the party? Free play ends and nobody can sign up or log scores after this. The TV and results stay up. You can reopen it.')) return;
                run(() => (freePlay ? host.freePlay(false) : host.setStatus('closed')), 'The party is closed. Thanks for hosting!');
              }}>Close the party</button>
            ) : (
              <button className="ghost" type="button" disabled={busy || !party} onClick={() => run(() => host.setStatus('open'), 'The party is open again.')}>Reopen</button>
            )}
          </div>
        </li>
        <li>
          <b>Email everyone their results (the next morning).</b> <span className="muted small">Only players who ticked "email me results" get one, with the same prizes as the TV. Free play never shows up in them. Send a sample to yourself first.</span>
          {event?.results_sent_at && <div className="muted small">Already sent {new Date(event.results_sent_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.</div>}
          {revealing && <div className="muted small">Uses the saved prizes (the same as the TV).</div>}
          <div className="row gap" style={{ marginTop: 8 }}>
            <button className="ghost" type="button" disabled={busy || running || phase === 'grace' || !event} onClick={() => {
              if (event.results_sent_at && !confirm('Results were ALREADY emailed once. Send them again to everyone?')) return;
              if (!event.results_sent_at && !confirm('Email final results now to every player who asked for them?')) return;
              run(() => emailResults(event.id), r => `Results emailed to ${r?.sent ?? 0} player${r?.sent === 1 ? '' : 's'}${r?.skipped ? ` (${r.skipped} didn't want email)` : ''}.`);
            }}>{running ? 'End the tournament first' : phase === 'grace' ? 'Wait for the last scores' : 'Email results'}</button>
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
  const queue = scores.filter(s => s.needs_review && !s.voided && !s.free_play).sort((a, b) => b.id - a.id);
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
  const [counts, setCounts] = useState(''); // '' by the clock, 'yes', 'no'
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
        <select value={counts} onChange={e => setCounts(e.target.value)} aria-label="Counts for the tournament?">
          <option value="">Counts: by the clock</option>
          <option value="yes">Counts for the tournament</option>
          <option value="no">Free play (doesn't count)</option>
        </select>
        <button className="primary" type="button" disabled={busy || !ok}
          onClick={() => run(async () => { await host.addScore(Number(pid), Number(mid), Number(val), counts === '' ? null : counts === 'yes'); setVal(''); }, 'Score added.')}>Add</button>
      </div>
    </section>
  );
}

// A player without a phone (kids, guests whose phone died): name + emoji, no PIN. The host logs their
// scores in "Add or fix a score". Reset PIN later lets them sign in on a phone if they get one.
const KID_EMOJIS = ['👾', '🧙', '🥷', '🤖', '🦖', '👽', '🦸', '🧚', '🐉', '👻', '🤠', '🧞'];
function AddPlayer({ busy, run }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(KID_EMOJIS[0]);
  const ok = name.trim().length >= 1 && name.trim().length <= 24;
  return (
    <section className="card">
      <h2>Add a player without a phone</h2>
      <p className="muted small">For kids or anyone without a phone. No PIN needed: you log their scores above. They show on the TV like everyone else.</p>
      <div className="host-add host-add-player">
        <input value={name} maxLength={24} onChange={e => setName(e.target.value)} placeholder="nickname" aria-label="Nickname" />
        <select value={emoji} onChange={e => setEmoji(e.target.value)} aria-label="Emoji">
          {KID_EMOJIS.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <button className="primary" type="button" disabled={busy || !ok}
          onClick={() => run(async () => { await host.addPlayer(name.trim(), emoji); const n = name.trim(); setName(''); return n; }, n => `Added ${n}. Log their scores in "Add or fix a score".`)}>Add player</button>
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
