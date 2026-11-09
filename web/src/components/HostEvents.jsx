import { useMemo, useState } from 'react';
import { host, useParty } from '../lib/store.js';
import { Link } from 'react-router-dom';

const fmtDate = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date');

// Host: events (tournaments/parties). One is "current": phones, scoring and the TV all use it.
export default function HostEvents({ run, busy }) {
  const { events, allMachines, eventMachines, entries, allScores, party } = useParty();
  const currentId = party?.current_event_id;
  const [editing, setEditing] = useState(null); // null | 'new' | event

  const stats = useMemo(() => {
    const m = new Map(events.map(e => [e.id, { players: 0, scores: 0 }]));
    for (const x of entries) if (m.has(x.event_id)) m.get(x.event_id).players++;
    for (const s of allScores) if (!s.voided && m.has(s.event_id)) m.get(s.event_id).scores++;
    return m;
  }, [events, entries, allScores]);

  return (
    <section className="card host-events">
      <div className="row spread">
        <div>
          <h2>Events</h2>
          <p className="muted small">An event is one party. The ACTIVE one is what phones, scoring and the TV show. You normally only need one.</p>
        </div>
        {!editing && <button className="ghost" disabled={busy} onClick={() => setEditing('new')}>＋ New event</button>}
      </div>

      {editing && (
        <EventForm
          key={editing === 'new' ? 'new' : editing.id}
          event={editing === 'new' ? null : editing}
          machines={allMachines}
          picked={editing === 'new' ? allMachines.map(m => m.id) : eventMachines.filter(x => x.event_id === editing.id).map(x => x.machine_id)}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(form) => run(async () => { await host.saveEvent(form); setEditing(null); }, form.id ? 'Event saved.' : `${form.name} created${form.makeCurrent ? ' and active' : ''}.`)}
        />
      )}

      <ul className="ev-list">
        {events.map(e => {
          const st = stats.get(e.id) || { players: 0, scores: 0 };
          const live = e.id === currentId;
          const nMachines = eventMachines.filter(x => x.event_id === e.id).length;
          return (
            <li key={e.id} className={live ? 'live' : ''}>
              <div className="ev-main">
                <div className="ev-name">{live && <span className="ev-live">ACTIVE</span>}{e.name}</div>
                <div className="muted small">
                  {fmtDate(e.starts_on)} · {st.players} players · {st.scores} scores · {nMachines} machines · scores {e.status === 'open' ? 'on' : 'off'}
                  {e.results_sent_at ? ' · results emailed' : ''}
                </div>
              </div>
              <div className="ev-actions">
                {!live && <button className="ghost" disabled={busy} onClick={() => {
                  if (!confirm(`Switch to "${e.name}"? Phones, scoring and the TV all move to it.`)) return;
                  run(() => host.setCurrentEvent(e.id), `${e.name} is now the active event.`);
                }}>Make active</button>}
                <Link className="ghost" to={`/host/guests?event=${e.id}`}>Guest list</Link>
                <button className="ghost" disabled={busy} onClick={() => setEditing(e)}>Edit</button>
                {!live && <button className="ghost danger" disabled={busy} onClick={() => {
                  const c = prompt(`Delete "${e.name}"? Its ${st.scores} scores AND its guest list are deleted too. This can't be undone. Type DELETE to confirm.`);
                  if (c == null) return;
                  run(() => host.deleteEvent(e.id, c.trim()), `${e.name} deleted.`);
                }}>Delete</button>}
              </div>
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
    <form className="ev-form" onSubmit={e => { e.preventDefault(); onSave({ id: event?.id ?? null, name: name.trim(), startsOn: date, machineIds: [...ids], makeCurrent }); }}>
      <label className="field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="e.g. The Auction Party" /></label>
      <label className="field"><span>Date</span><input type="date" value={date || ''} onChange={e => setDate(e.target.value)} /></label>
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
