import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { actions, getHostPass, useAwards, useStandings } from '../lib/store.js';
import { friendlyError } from '../lib/errors.js';
import { machineArt } from '../lib/machineArt.js';
import { MIN_TABLES, fmt, ordinal, prizesFor } from '../lib/scoring.js';
import Avatar from '../components/Avatar.jsx';
import PixelEmoji from '../components/PixelEmoji.jsx';
import LedNumber from '../components/LedNumber.jsx';
import Sheet from '../components/Sheet.jsx';
import ShareTicket from '../components/ShareTicket.jsx';
import { fixTicketName, joinNames, stillToJoin, ticketPeople } from '../lib/ticketNames.js';
import { afterSheetClose } from '../lib/useBackClose.js';
import { fileToPortraitSource } from '../lib/image.js';
import Pixelating from '../components/Pixelating.jsx';
import { makeMyPixelAvatar } from '../lib/pixelAvatar.js';

const UNDO_MS = 15 * 60 * 1000;

export default function Me() {
  const { me, machines, players, scores, standings, party } = useStandings();
  const awards = useAwards(standings, null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [confirmUndo, setConfirmUndo] = useState(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [, tick] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [shot, setShot] = useState(null); // the photo being pixelated
  const selfieRef = useRef(null);
  async function onSelfie(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setDrawing(true);
    try { const photo = await fileToPortraitSource(file); setShot(photo); await makeMyPixelAvatar(photo); }
    catch (x) { setErr(friendlyError(x)); }
    finally { setDrawing(false); }
  }
  const nav = useNavigate();
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 15000); return () => clearInterval(t); }, []);

  const st = me ? standings.stats.get(me.id) : null;
  if (!st) return <div className="screen center"><div className="spinner" aria-label="Loading" /></div>;

  const ranked = standings.meta.rankedPlayers;
  const machineById = new Map(machines.map(m => [m.id, m]));
  const playerById = new Map((players ?? []).map(p => [p.id, p]));
  // Scores a friend logged for me show who did it, with their avatar.
  const loggedBy = s => {
    const p = s.logged_by && s.logged_by !== me.id ? playerById.get(s.logged_by) : null;
    return p ? (
      <span className="logged-by">
        BY <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={20} />
        <span className="logged-by-name">{p.display_name}</span>
      </span>
    ) : null;
  };
  const mineAll = scores.filter(s => s.player_id === me.id).sort((a, b) => b.id - a.id);
  const open = party?.status === 'open';
  const fresh = s => !s.voided && open && Date.now() - new Date(s.created_at).getTime() < UNDO_MS;
  // Mine, plus ones I logged for other players (the server lets me undo those too).
  const undoable = scores
    .filter(s => (s.player_id === me.id || s.logged_by === me.id) && fresh(s))
    .sort((a, b) => b.id - a.id);
  const forName = s => (s.player_id !== me.id ? playerById.get(s.player_id)?.display_name ?? 'someone' : null);
  const recent = mineAll.slice(0, 15);

  const held = prizesFor(awards, me.id);

  async function undo(s) {
    setErr(''); setBusyId(s.id);
    try { await actions.undoScore(s.id); setConfirmUndo(null); }
    catch (e) { setErr(friendlyError(e)); setConfirmUndo(null); }
    finally { setBusyId(null); }
  }

  function signOutTo(path) {
    setSwitchOpen(false);
    afterSheetClose(() => { actions.signOut(); nav(path, { replace: true }); });
  }

  const minsLeft = s => Math.max(1, Math.ceil((UNDO_MS - (Date.now() - new Date(s.created_at).getTime())) / 60000));

  return (
    <div className="screen me-page">
      <div className="me-head">
        <button type="button" className={`me-avatar-btn${drawing ? ' drawing' : ''}`} onClick={() => selfieRef.current?.click()} disabled={drawing} aria-label="Change photo">
          {drawing
            ? <Pixelating size={64} label={false} src={shot} />
            : <Avatar avatar={me.avatar} emoji={me.emoji} name={me.display_name} color={me.color} size={64} ring />}
          {!drawing && <span className="me-avatar-tag"><PixelEmoji e="📷" size={14} /></span>}
        </button>
        <input ref={selfieRef} type="file" accept="image/*" capture="user" onChange={onSelfie} hidden />
        <div className="grow">
          <h1>{me.display_name}</h1>
          <div className="muted small">{st.plays} game{st.plays === 1 ? '' : 's'} · {st.machinesPlayed} of {machines.length} machines</div>
          <button type="button" className="linkbtn small me-photo-link" onClick={() => selfieRef.current?.click()} disabled={drawing}>
            {drawing ? 'Making your 8-bit self…' : 'Change photo'}
          </button>
          <div className="muted tiny-note">Need a different name? Ask the host.</div>
        </div>
      </div>
      <button type="button" className="ghost-btn small me-switch" onClick={() => setSwitchOpen(true)}>Sign out / switch player</button>

      {undoable.length > 0 && (
        <section className="panel undo-panel">
          <h3>Just logged</h3>
          <div className="muted small">Wrong one? Undo within 15 min.</div>
          <ul className="undo-list">
            {undoable.map(s => (
              <li key={s.id}>
                <img src={machineArt(machineById.get(s.machine_id)?.name ?? '')} alt="" />
                <div className="ul-body">
                  <div className="ul-name">{machineById.get(s.machine_id)?.name}</div>
                  {forName(s) ? <div className="ul-for">for {forName(s)}</div> : loggedBy(s)}
                  <div className="mono amber">{fmt(s.value)}</div>
                </div>
                <button type="button" className="undo-btn small" disabled={busyId === s.id} onClick={() => setConfirmUndo(s)}>
                  ↶ Undo <span className="undo-time">{minsLeft(s)}m</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {err && <div className="err" role="alert">{err}</div>}

      <section className="me-rating">
        {st.rating != null ? (
          <>
            <LedNumber value={st.rating} size="md" />
            <div>
              <div className="me-rating-rank">{ordinal(st.rank)} of {ranked}</div>
              <div className="muted small">Your rating = your average points across the machines you played (1st on a machine = 100). Higher is better.</div>
            </div>
          </>
        ) : (
          <div>
            <div className="me-rating-rank">{st.machinesPlayed === 0 ? 'No scores yet' : `${MIN_TABLES - st.machinesPlayed} more machine${MIN_TABLES - st.machinesPlayed === 1 ? '' : 's'} to get ranked`}</div>
            <div className="muted small">Log a score on {MIN_TABLES} different machines to get a rating and a spot on the leaderboard.</div>
          </div>
        )}
      </section>

      <TicketPanel me={me} />

      {held.length > 0 && (
        <section className="panel">
          <h3>You're leading</h3>
          <ul className="held">{held.map(h => <li key={h}>{h}</li>)}</ul>
          <div className="muted small">Final when scoring closes.</div>
        </section>
      )}

      <section className="panel">
        <h3>Machines</h3>
        <div className="muted small">Points per machine: 1st = 100, lower places get less. Your rating is the average.</div>
        <div className="me-machines">
          {machines.map(m => {
            const pm = st.perMachine[m.id];
            return (
              <Link key={m.id} to={`/machine/${m.id}`} className={`me-machine${pm ? '' : ' todo'}`}>
                <img src={machineArt(m.name)} alt="" loading="lazy" />
                <div className="me-machine-body">
                  <div className="me-machine-name">{m.name}</div>
                  {pm
                    ? <div className="small"><strong>{pm.rank === 1 ? '👑 ' : ''}{ordinal(pm.rank)} of {pm.N}</strong> · best <span className="mono amber">{fmt(pm.best)}</span></div>
                    : <div className="small muted">Not played</div>}
                </div>
                {pm
                  ? <div className="me-standing" aria-label={`${pm.standing} of 100 points`}>{pm.standing}<span className="me-standing-label">pts</span></div>
                  : <span className="me-go">›</span>}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h3>Your scores</h3>
        {recent.length === 0 && <div className="muted small">Nothing yet. Go play!</div>}
        <ul className="recent">
          {recent.map(s => (
            <li key={s.id} className={s.voided ? 'voided' : ''}>
              <span className="recent-what">{machineById.get(s.machine_id)?.name}{loggedBy(s)}</span>
              <span className="mono">{fmt(s.value)}</span>
              <span className="muted small">{s.voided ? 'removed' : timeAgo(s.created_at)}</span>
            </li>
          ))}
        </ul>
        <div className="muted small">Older typo? Ask the host.</div>
      </section>

      <Sheet open={!!confirmUndo} onClose={() => setConfirmUndo(null)} title="Undo this score?">
        {confirmUndo && (
          <>
            <div className="center-text">{machineById.get(confirmUndo.machine_id)?.name}{forName(confirmUndo) ? ` · for ${forName(confirmUndo)}` : ''}</div>
            <LedNumber value={confirmUndo.value} size="lg" />
            <div className="muted small center-text">It comes off the board. Then log the right one.</div>
            <div className="sheet-actions two">
              <button type="button" className="ghost-btn" onClick={() => setConfirmUndo(null)}>Keep it</button>
              <button type="button" className="cta danger" disabled={busyId === confirmUndo.id} onClick={() => undo(confirmUndo)}>
                {busyId === confirmUndo.id ? 'Removing…' : 'Undo score'}
              </button>
            </div>
          </>
        )}
      </Sheet>

      <EmailPanel me={me} />

      {getHostPass() && <Link to="/host" className="host-link">🔧 Host tools</Link>}

      <Sheet open={switchOpen} onClose={() => setSwitchOpen(false)} title="Sign out / switch player">
        <div className="muted small">Your scores stay saved. Get back in any time with your name + PIN.</div>
        <button type="button" className="cta" onClick={() => signOutTo('/rejoin')}>Sign in as someone else</button>
        <button type="button" className="ghost-btn" onClick={() => signOutTo('/join')}>Add a new player</button>
        <div className="muted small center-text">Forgot a PIN? Find the host — they can reset it in seconds.</div>
      </Sheet>
    </div>
  );
}

function timeAgo(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

// Signed up from a ticket link? Share that same link so someone else on the ticket
// (like a partner) can sign up on their own phone. Hidden for players without a ticket.
function TicketPanel({ me }) {
  const [ticket, setTicket] = useState(null); // { invite, others: [names of the rest of the ticket], left: [people still to sign up] }
  const [editWho, setEditWho] = useState(null); // fixing which person / spelling (string while editing)
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setTicket(null);
    (async () => {
      const invite = await actions.myTicket().catch(() => null);
      if (!invite || !live) return;
      setTicket({ invite, others: [], left: [] });
      const info = await actions.ticketInfo(invite).catch(() => null);
      if (!info || !live) return;
      const ids = info.player_ids;
      const others = (info.players || []).filter((n, i) => (ids ? ids[i] !== me.id : n !== me.display_name));
      // A couple's ticket ("Chris and Cina Boitnott"): who hasn't signed up yet.
      const left = Array.isArray(info.taken) && ticketPeople(info.name).length > 1 ? stillToJoin(info.name, info.taken) : [];
      const mine = ids && Array.isArray(info.player_whos) ? info.player_whos[ids.indexOf(me.id)] ?? null : undefined;
      setTicket({ invite, others, left, name: info.name, mine });
    })();
    return () => { live = false; };
  }, [me.id, me.display_name, reload]);
  if (!ticket) return null;
  const { invite, others, left, name, mine } = ticket;
  const them = left.length === 1 ? left[0].first : 'them';
  const people = ticketPeople(name);
  async function saveWho(full) {
    const next = full.trim().replace(/\s+/g, ' ');
    if (!next) return;
    await actions.setTicketWho(next, mine ? fixTicketName(name, mine, next) : null);
    setEditWho(null); setReload(r => r + 1);
  }
  return (
    <section className="panel ticket-panel">
      {people.length > 1 && mine !== undefined && (editWho != null ? (
        <form className="who-edit" onSubmit={e => { e.preventDefault(); saveWho(editWho); }}>
          <div className="who-pick">
            {people.map(p => (
              <button type="button" key={p.full} className={`who-btn${editWho === p.full ? ' on' : ''}`} onClick={() => setEditWho(p.full)}>{p.first}</button>
            ))}
          </div>
          <label className="field"><span>Your name, spelled right</span>
            <input value={editWho} onChange={e => setEditWho(e.target.value)} maxLength={60} autoCapitalize="words" />
          </label>
          <div className="who-edit-actions">
            <button type="submit" className="ghost-btn small">Save</button>
            <button type="button" className="link" onClick={() => setEditWho(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="ticket-with">
          {mine ? <>On this ticket as <strong>{mine}</strong>. </> : <>Which one are you on this ticket? </>}
          <button type="button" className="link" onClick={() => setEditWho(mine || '')}>{mine ? 'Wrong or misspelled? Fix it' : 'Tell us'}</button>
        </div>
      ))}
      {left.length ? (
        <>
          <h3>Still to sign up: {joinNames(left.map(p => p.first))}</h3>
          <div className="muted small">Send {them} your ticket link. They sign up on their own phone.</div>
          <ShareTicket invite={invite} big label={`Send ${them} the link`} />
          <div className="muted small">
            With you? <a href={`/join?invite=${encodeURIComponent(invite)}&here=1`} className="link">Sign {them} up on this phone</a>
          </div>
        </>
      ) : others.length ? (
        <>
          <h3>Your ticket</h3>
          <div className="ticket-with">With: <strong>{others.join(', ')}</strong></div>
          <div className="muted small">Someone else coming? Send them your link too.</div>
          <ShareTicket invite={invite} label="Send my ticket link" />
        </>
      ) : (
        <>
          <h3>Bringing someone?</h3>
          <div className="muted small">Send them your ticket link. They sign up on their own phone.</div>
          <ShareTicket invite={invite} big label="Send my ticket link" />
        </>
      )}
      {!left.length && (
        <div className="muted small">
          No phone? <a href={`/join?invite=${encodeURIComponent(invite)}&here=1`} className="link">Sign them up on this one</a>
        </div>
      )}
    </section>
  );
}

// Results email: opt in with consent, or turn it off. The address is never shown back (private).
function EmailPanel({ me }) {
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  async function save(on) {
    setBusy(true); setNote('');
    try {
      await actions.setMyEmail(on ? email.trim() : null, on);
      if (on) await actions.linkByEmail(email.trim()); // joined without a ticket link? match them to their guest row
      setNote(on ? 'Saved. Results come after the event.' : 'Results email off.');
      setEmail(''); setConsent(false);
    } catch (e) { setNote(`⚠️ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  }
  return (
    <section className="panel email-panel">
      <h3>Results email</h3>
      {me.has_email ? (
        <>
          <div className="muted small">ON. Final results get emailed after each event. Never marketing.</div>
          <button type="button" className="ghost-btn small" disabled={busy} onClick={() => save(false)}>Turn off</button>
        </>
      ) : (
        <form onSubmit={e => { e.preventDefault(); if (consent && email.trim()) save(true); }}>
          <label className="field">
            <span>Get your final results by email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" inputMode="email" autoCapitalize="none" />
          </label>
          <label className="field row consent">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            <span>Yes, email me my results. Never used for marketing.</span>
          </label>
          <button type="submit" className="ghost-btn small" disabled={busy || !consent || !email.trim()}>Save</button>
        </form>
      )}
      {note && <div className={note.startsWith('⚠️') ? 'err' : 'muted small'}>{note}</div>}
    </section>
  );
}

