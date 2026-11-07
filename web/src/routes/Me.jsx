import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { actions, useAwards, useStandings } from '../lib/store.js';
import { machineArt } from '../lib/machineArt.js';
import { MIN_TABLES, fmt, ordinal } from '../lib/scoring.js';
import Avatar from '../components/Avatar.jsx';
import LedNumber from '../components/LedNumber.jsx';
import Sheet from '../components/Sheet.jsx';
import { afterSheetClose } from '../lib/useBackClose.js';

const UNDO_MS = 15 * 60 * 1000;

export default function Me() {
  const { me, machines, scores, standings, party } = useStandings();
  const awards = useAwards(standings, null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [confirmUndo, setConfirmUndo] = useState(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [, tick] = useState(0);
  const nav = useNavigate();
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 15000); return () => clearInterval(t); }, []);

  const st = me ? standings.stats.get(me.id) : null;
  if (!st) return <div className="screen center"><div className="spinner" aria-label="Loading" /></div>;

  const ranked = standings.meta.rankedPlayers;
  const machineById = new Map(machines.map(m => [m.id, m]));
  const mineAll = scores.filter(s => s.player_id === me.id).sort((a, b) => b.id - a.id);
  const open = party?.status === 'open';
  const undoable = mineAll.filter(s => !s.voided && open && Date.now() - new Date(s.created_at).getTime() < UNDO_MS);
  const recent = mineAll.slice(0, 15);

  const held = [];
  if (awards.champion?.player.id === me.id) held.push('🏆 Overall Champion');
  if (awards.beginnersLuck?.player.id === me.id) held.push("⭐ Beginner's Luck");
  if (awards.grinder?.player.id === me.id) held.push('🔁 The Grinder');
  if (awards.globetrotters?.some(p => p.id === me.id)) held.push('🌍 Globetrotter');
  if (awards.bigWhiff?.player.id === me.id) held.push('💥 The Big Whiff (oops)');
  for (const h of awards.heartbreakers ?? []) if (h.player?.id === me.id) held.push(`💔 Heartbreaker on ${h.machine.name}`);
  for (const m of standings.machines) if (m.champion?.player.id === me.id) held.push(`👑 ${m.machine.name} champion`);

  async function undo(s) {
    setErr(''); setBusyId(s.id);
    try { await actions.undoScore(s.id); setConfirmUndo(null); }
    catch (e) { setErr(e.message); setConfirmUndo(null); }
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
        <Avatar avatar={me.avatar} emoji={me.emoji} name={me.display_name} color={me.color} size={64} ring />
        <div className="grow">
          <h1>{me.display_name}</h1>
          <div className="muted small">{st.plays} game{st.plays === 1 ? '' : 's'} · {st.machinesPlayed}/{machines.length}</div>
        </div>
        <button type="button" className="ghost-btn small" onClick={() => setSwitchOpen(true)}>Switch</button>
      </div>

      {undoable.length > 0 && (
        <section className="panel undo-panel">
          <h3>Just logged</h3>
          <div className="muted small">Typo? Undo within 15 min.</div>
          <ul className="undo-list">
            {undoable.map(s => (
              <li key={s.id}>
                <img src={machineArt(machineById.get(s.machine_id)?.name ?? '')} alt="" />
                <div className="ul-body">
                  <div className="ul-name">{machineById.get(s.machine_id)?.name}</div>
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
              <div className="muted small">Avg finish on your tables. 100 = 1st on all.</div>
            </div>
          </>
        ) : (
          <div>
            <div className="me-rating-rank">{st.machinesPlayed === 0 ? 'No scores yet' : `${MIN_TABLES - st.machinesPlayed} MORE TABLE TO RANK`}</div>
            <div className="muted small">Score on {MIN_TABLES} tables to get a rating.</div>
          </div>
        )}
      </section>

      {held.length > 0 && (
        <section className="panel">
          <h3>You're leading</h3>
          <ul className="held">{held.map(h => <li key={h}>{h}</li>)}</ul>
          <div className="muted small">Final when scoring closes.</div>
        </section>
      )}

      <section className="panel">
        <h3>Machines</h3>
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
                {pm ? <div className="me-standing" title="standing (100 = 1st)">{pm.standing}</div> : <span className="me-go">›</span>}
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
              <span>{machineById.get(s.machine_id)?.name}</span>
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
            <div className="center-text">{machineById.get(confirmUndo.machine_id)?.name}</div>
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

      <Link to="/host" className="host-link">🔧 Host tools</Link>

      <Sheet open={switchOpen} onClose={() => setSwitchOpen(false)} title="Switch player">
        <div className="muted small">Your scores stay saved. Get back in with name + PIN.</div>
        <button type="button" className="cta" onClick={() => signOutTo('/rejoin')}>Already joined</button>
        <button type="button" className="ghost-btn" onClick={() => signOutTo('/join')}>New player</button>
        <div className="muted small center-text">Forgot your PIN? The host can reset it.</div>
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
