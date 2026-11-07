import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { actions, useAwards, useStandings } from '../lib/store.js';
import { machineArt } from '../lib/machineArt.js';
import { MIN_TABLES, fmt, ordinal } from '../lib/scoring.js';
import Avatar from '../components/Avatar.jsx';

const UNDO_MS = 15 * 60 * 1000;

export default function Me() {
  const { me, machines, scores, standings, party } = useStandings();
  const awards = useAwards(standings, null);
  const [err, setErr] = useState('');
  const [, force] = useState(0);
  const nav = useNavigate();
  const st = me ? standings.stats.get(me.id) : null;
  if (!st) return <div className="muted">Loading…</div>;

  const ranked = standings.meta.rankedPlayers;
  const machineById = new Map(machines.map(m => [m.id, m]));
  const recent = scores.filter(s => s.player_id === me.id).sort((a, b) => b.id - a.id).slice(0, 12);

  // Prizes you're currently holding
  const held = [];
  if (awards.champion?.player.id === me.id) held.push('🏆 Overall Champion');
  if (awards.beginnersLuck?.player.id === me.id) held.push("⭐ Beginner's Luck");
  if (awards.grinder?.player.id === me.id) held.push('🔁 The Grinder');
  if (awards.globetrotters?.some(p => p.id === me.id)) held.push('🌍 Globetrotter');
  if (awards.bigWhiff?.player.id === me.id) held.push('💥 The Big Whiff (oops)');
  for (const h of awards.heartbreakers ?? []) if (h.player?.id === me.id) held.push(`💔 Heartbreaker on ${h.machine.name}`);
  for (const m of standings.machines) if (m.champion?.player.id === me.id) held.push(`👑 ${m.machine.name} champion`);

  async function undo(id) {
    setErr('');
    try { await actions.undoScore(id); force(x => x + 1); } catch (e) { setErr(e.message); }
  }

  return (
    <div className="screen me-page">
      <div className="me-head">
        <Avatar avatar={me.avatar} emoji={me.emoji} name={me.display_name} color={me.color} size={64} ring />
        <div>
          <h1>{me.display_name}</h1>
          <div className="muted small">{st.plays} game{st.plays === 1 ? '' : 's'} ·{st.machinesPlayed}/{machines.length} machines</div>
        </div>
      </div>

      <section className="me-rating">
        {st.rating != null ? (
          <>
            <div className="me-rating-num">{st.rating}<span>/100</span></div>
            <div>
              <div className="me-rating-rank">{ordinal(st.rank)} of {ranked}</div>
              <div className="muted small">Rating = your average finish across the machines you played. 100 = 1st everywhere.</div>
            </div>
          </>
        ) : (
          <div>
            <div className="me-rating-rank">{st.machinesPlayed === 0 ? 'No scores yet' : `Play ${MIN_TABLES - st.machinesPlayed} more machine to get ranked`}</div>
            <div className="muted small">You need scores on {MIN_TABLES} different machines for an overall rating.</div>
          </div>
        )}
      </section>

      {held.length > 0 && (
        <section className="card-lite">
          <h3>You're leading</h3>
          <ul className="held">{held.map(h => <li key={h}>{h}</li>)}</ul>
          <div className="muted small">Prizes are decided when the host closes scoring.</div>
        </section>
      )}

      <section className="card-lite">
        <h3>Machines</h3>
        <div className="me-machines">
          {machines.map(m => {
            const pm = st.perMachine[m.id];
            return (
              <Link key={m.id} to={`/machine/${m.id}`} className={`me-machine${pm ? '' : ' todo'}`}>
                <img src={machineArt(m.name)} alt="" />
                <div className="me-machine-body">
                  <div className="me-machine-name">{m.name}</div>
                  {pm
                    ? <div className="small"><strong>{pm.rank === 1 ? '👑 ' : ''}{ordinal(pm.rank)} of {pm.N}</strong> · best {fmt(pm.best)}</div>
                    : <div className="small muted">Not played yet. Tap to log a score.</div>}
                </div>
                {pm && <div className="me-standing" title="standing">{pm.standing}</div>}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="card-lite">
        <h3>Your recent scores</h3>
        {recent.length === 0 && <div className="muted small">Nothing yet.</div>}
        {err && <div className="err">{err}</div>}
        <ul className="recent">
          {recent.map(s => {
            const canUndo = !s.voided && party?.status === 'open' && Date.now() - new Date(s.created_at).getTime() < UNDO_MS;
            return (
              <li key={s.id} className={s.voided ? 'voided' : ''}>
                <span>{machineById.get(s.machine_id)?.name}</span>
                <span className="mono">{fmt(s.value)}</span>
                <span>{s.voided ? <span className="muted small">removed</span> : canUndo ? <button className="ghost" onClick={() => undo(s.id)}>Undo</button> : null}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <button className="linkbtn small" onClick={() => { actions.signOut(); nav('/join'); }}>
        Not you? Sign out on this phone
      </button>
    </div>
  );
}
