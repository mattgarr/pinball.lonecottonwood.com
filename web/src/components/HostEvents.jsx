import { useMemo, useState } from 'react';
import { host, useParty } from '../lib/store.js';
import { Link } from 'react-router-dom';
import Avatar from './Avatar.jsx';

const fmtDate = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Ongoing (no end date)');

// Host: events (tournaments/parties). One is "current": phones, scoring and the TV all use it.
// Player accounts are permanent across all events; each event tracks its own participants, guest list, machines, and scores.
export default function HostEvents({ run, busy }) {
  const { events, allMachines, eventMachines, entries, allScores, players, party } = useParty();
  const currentId = party?.current_event_id;
  const [editing, setEditing] = useState(null); // null | 'new' | event
  const [openRosterId, setOpenRosterId] = useState(null); // event.id whose participant list is expanded
  const [evSearch, setEvSearch] = useState('');
  const [evFilter, setEvFilter] = useState('all'); // 'all' | 'ongoing' | 'dated'

  const byEvent = useMemo(() => {
    const m = new Map(events.map(e => [e.id, { playerIds: new Set(), gamesByPlayer: new Map(), scores: 0 }]));
    for (const x of entries) {
      if (m.has(x.event_id)) m.get(x.event_id).playerIds.add(x.player_id);
    }
    for (const s of allScores) {
      if (s.voided || !m.has(s.event_id)) continue;
      const b = m.get(s.event_id);
      b.scores++;
      b.playerIds.add(s.player_id);
      b.gamesByPlayer.set(s.player_id, (b.gamesByPlayer.get(s.player_id) || 0) + 1);
    }
    return m;
  }, [events, entries, allScores]);

  const filteredEvents = useMemo(() => {
    const q = evSearch.trim().toLowerCase();
    return events.filter(e => {
      if (evFilter === 'ongoing' && e.starts_on) return false;
      if (evFilter === 'dated' && !e.starts_on) return false;
      if (q && !e.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [events, evSearch, evFilter]);

  return (
    <section id="sec-events" className="card host-events">
      <div className="host-card-head">
        <div>
          <h2>Events &amp; tournaments ({events.length})</h2>
          <p className="muted small">
            Each event has its own leaderboard, scores, machines, and guest list. Player accounts (nickname + PIN) carry over across all events.
            The <b>ACTIVE</b> event is what phones, scoring, and the TV show right now.
          </p>
        </div>
        {!editing && <button className="primary" type="button" disabled={busy} onClick={() => setEditing('new')}>＋ New event</button>}
      </div>

      {editing && (
        <EventForm
          key={editing === 'new' ? 'new' : editing.id}
          event={editing === 'new' ? null : editing}
          machines={allMachines}
          picked={editing === 'new' ? allMachines.map(m => m.id) : eventMachines.filter(x => x.event_id === editing.id).map(x => x.machine_id)}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(form) => run(async () => { await host.saveEvent(form); setEditing(null); }, form.id ? 'Event saved.' : `${form.name} created${form.makeCurrent ? ' and set active' : ''}.`)}
        />
      )}

      {events.length > 2 && (
        <div className="host-toolbar">
          <input
            className="host-filter"
            value={evSearch}
            onChange={e => setEvSearch(e.target.value)}
            placeholder="search events…"
          />
          <div className="row gap">
            <button type="button" className={evFilter === 'all' ? 'primary' : 'ghost'} onClick={() => setEvFilter('all')}>All ({events.length})</button>
            <button type="button" className={evFilter === 'ongoing' ? 'primary' : 'ghost'} onClick={() => setEvFilter('ongoing')}>Ongoing</button>
            <button type="button" className={evFilter === 'dated' ? 'primary' : 'ghost'} onClick={() => setEvFilter('dated')}>Scheduled</button>
          </div>
        </div>
      )}

      <ul className="ev-list">
        {filteredEvents.map(e => {
          const info = byEvent.get(e.id) || { playerIds: new Set(), gamesByPlayer: new Map(), scores: 0 };
          const live = e.id === currentId;
          const nMachines = eventMachines.filter(x => x.event_id === e.id).length;
          const rosterOpen = openRosterId === e.id;
          const inPlayers = players
            .filter(p => info.playerIds.has(p.id))
            .sort((a, b) => (info.gamesByPlayer.get(b.id) || 0) - (info.gamesByPlayer.get(a.id) || 0) || a.display_name.localeCompare(b.display_name));
          const outPlayers = players
            .filter(p => !info.playerIds.has(p.id))
            .sort((a, b) => a.display_name.localeCompare(b.display_name));

          return (
            <li key={e.id} className={live ? 'live' : ''}>
              <div className="ev-main">
                <div className="ev-title-row">
                  <div className="ev-name">
                    {live && <span className="ev-live">ACTIVE</span>}
                    {e.name}
                  </div>
                  <span className={`ev-stat-badge ${e.status === 'open' ? 'on' : 'off'}`}>
                    {e.status === 'open' ? 'SCORES ON' : 'SCORES OFF'}
                  </span>
                </div>
                <div className="ev-meta muted small">
                  <span>{fmtDate(e.starts_on)}</span>
                  <span>·</span>
                  <span>{inPlayers.length} player{inPlayers.length === 1 ? '' : 's'}</span>
                  <span>·</span>
                  <span>{info.scores} score{info.scores === 1 ? '' : 's'}</span>
                  <span>·</span>
                  <span>{nMachines} machine{nMachines === 1 ? '' : 's'}</span>
                  {e.results_sent_at ? <><span>·</span><span>results emailed</span></> : null}
                </div>
              </div>
              <div className="ev-actions">
                {live
                  ? <button className="ghost ev-active-btn" type="button" disabled>★ Active</button>
                  : <button className="primary" type="button" disabled={busy} onClick={() => {
                      if (!confirm(`Make "${e.name}" the active event? Every phone and the TV switch to it right away.`)) return;
                      run(() => host.setCurrentEvent(e.id), `${e.name} is now the active event.`);
                    }}>Make active</button>}
                <button className={`ghost${rosterOpen ? ' on' : ''}`} type="button" onClick={() => setOpenRosterId(rosterOpen ? null : e.id)}>
                  {rosterOpen ? 'Hide players ▲' : `Players (${inPlayers.length}) ▼`}
                </button>
                <Link className="ghost" to={`/host/guests?event=${e.id}`}>Guest list &amp; emails</Link>
                <button className="ghost" type="button" disabled={busy} onClick={() => setEditing(e)}>Edit</button>
                <button
                  className="ghost danger"
                  type="button"
                  disabled={busy || live}
                  title={live ? 'Switch to another active event before deleting this one' : `Delete ${e.name}`}
                  onClick={() => {
                    if (live) return;
                    const c = prompt(`Delete "${e.name}"? Its ${info.scores} scores AND its guest list are deleted too (permanent player accounts are kept). Type DELETE to confirm.`);
                    if (c == null) return;
                    run(() => host.deleteEvent(e.id, c.trim()), `${e.name} deleted.`);
                  }}
                >
                  Delete
                </button>
              </div>

              {rosterOpen && (
                <div className="ev-roster">
                  <div className="ev-roster-head">
                    <span className="muted small">
                      Participating in <b>{e.name}</b> ({inPlayers.length} of {players.length} total accounts). Guests are added automatically when they open the app, claim a ticket, or log a score while this event is active.
                    </span>
                    {outPlayers.length > 0 && (
                      <select
                        className="ev-add-player"
                        value=""
                        disabled={busy}
                        onChange={ev => {
                          const pid = Number(ev.target.value);
                          if (!pid) return;
                          const p = players.find(x => x.id === pid);
                          run(() => host.setEntry(e.id, pid, true), `Added ${p?.display_name || 'player'} to ${e.name}.`);
                        }}
                      >
                        <option value="">+ Add existing player…</option>
                        {outPlayers.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                      </select>
                    )}
                  </div>
                  {inPlayers.length === 0 ? (
                    <div className="muted small">No players in this event yet.</div>
                  ) : (
                    <div className="ev-roster-list">
                      {inPlayers.map(p => {
                        const g = info.gamesByPlayer.get(p.id) || 0;
                        return (
                          <div key={p.id} className="ev-roster-chip">
                            <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={22} />
                            <span>{p.display_name}</span>
                            <span className="muted small">{g}g</span>
                            {g === 0 && (
                              <button
                                type="button"
                                className="ev-roster-rm"
                                title={`Remove ${p.display_name} from ${e.name}`}
                                disabled={busy}
                                onClick={() => run(() => host.setEntry(e.id, p.id, false), `Removed ${p.display_name} from ${e.name}.`)}
                              >×</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EventForm({ event, machines, picked, busy, onCancel, onSave }) {
  const [name, setName] = useState(event?.name || '');
  const [date, setDate] = useState(event?.starts_on || '');
  const [ids, setIds] = useState(() => new Set(picked));
  const [makeCurrent, setMakeCurrent] = useState(false);
  const toggle = id => setIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <form className="ev-form" onSubmit={e => { e.preventDefault(); onSave({ id: event?.id ?? null, name: name.trim(), startsOn: date || null, machineIds: [...ids], makeCurrent }); }}>
      <label className="field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="e.g. Spinning Cats" /></label>
      <label className="field">
        <span>Date (optional — leave blank for an ongoing / multi-day tournament)</span>
        <div className="row gap">
          <input type="date" value={date || ''} onChange={e => setDate(e.target.value)} />
          {date && <button type="button" className="ghost" onClick={() => setDate('')}>Clear date (ongoing)</button>}
        </div>
      </label>
      <div className="field"><span>Machines</span>
        <div className="ev-machines">
          {machines.map(m => (
            <label key={m.id} className="field row"><input type="checkbox" checked={ids.has(m.id)} onChange={() => toggle(m.id)} /><span>{m.name}</span></label>
          ))}
        </div>
      </div>
      {!event && <label className="field row"><input type="checkbox" checked={makeCurrent} onChange={e => setMakeCurrent(e.target.checked)} /><span>Make it the active event now</span></label>}
      <div className="row gap">
        <button className="primary" disabled={busy || !name.trim() || !ids.size} type="submit">{event ? 'Save' : 'Create'}</button>
        <button className="ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
