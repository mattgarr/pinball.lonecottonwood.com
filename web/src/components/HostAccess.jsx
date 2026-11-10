import { useCallback, useEffect, useState } from 'react';
import { hostAccess } from '../lib/access.js';
import '../landing.css';

// Host page: who can join (party password, party QR key, pause sign-ups) and the "Need help?" inbox.
export default function HostAccess({ run, busy }) {
  return (
    <div className="host-grid-2 access-grid" id="sec-access">
      <AccessCard run={run} busy={busy} />
      <HelpCard run={run} busy={busy} />
    </div>
  );
}

function AccessCard({ run, busy }) {
  const [a, setA] = useState(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  useEffect(() => { hostAccess.get().then(setA).catch(e => setErr(e.message)); }, []);
  const save = (opts, done) => run(async () => { const r = await hostAccess.set(opts); setA(r); return r; }, done);

  if (!a) {
    return (
      <section className="card">
        <h2>Party access</h2>
        <p className="muted small">{err ? `Couldn't load: ${err}. (Is migration 0030 in?)` : 'Loading…'}</p>
      </section>
    );
  }
  const locked = a.locked_until && new Date(a.locked_until) > new Date();
  return (
    <section className="card access-card">
      <h2>Party access</h2>
      <div className="access-pills">
        <span className={`access-pill${a.signups_open ? '' : ' off'}`}>{a.signups_open ? 'Sign-ups open' : 'Sign-ups paused'}</span>
        {locked && <span className="access-pill off">Password locked 1 min</span>}
      </div>
      <p className="muted small">
        Guests join by scanning a party QR code (the TV or the printed sheet), by typing this password at
        pinball.lonecottonwood.com, or with their own ticket link from the email. Strangers only see a landing page.
      </p>
      <div className="access-pass" aria-label="Party password">{a.password}</div>
      {editing ? (
        <form className="access-form" onSubmit={e => {
          e.preventDefault();
          save({ password: draft }, 'Party password changed.').then(r => { if (r) setEditing(false); });
        }}>
          <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={40} aria-label="New party password" autoCapitalize="characters" />
          <button className="primary" type="submit" disabled={busy || !draft.trim()}>Save</button>
          <button className="ghost" type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : (
        <div className="access-actions">
          <button className="ghost" type="button" disabled={busy} onClick={() => { setDraft(a.password); setEditing(true); }}>Change password</button>
          <button className="ghost" type="button" disabled={busy} onClick={() => {
            if (confirm('Make up a new random password? The old one stops working right away.')) save({ password: '' }, 'New party password made.');
          }}>New random</button>
          <a className="ghost" href="/host/qr" target="_blank" rel="noreferrer">Print QR codes ↗</a>
        </div>
      )}
      <div className="access-actions">
        <button className={a.signups_open ? 'secondary' : 'primary'} type="button" disabled={busy} onClick={() => {
          if (a.signups_open && !confirm('Pause new sign-ups? The party QR codes and password stop working for new players. Ticket links and phones already signed in still work.')) return;
          save({ open: !a.signups_open }, a.signups_open ? 'New sign-ups paused.' : 'Sign-ups are open.');
        }}>{a.signups_open ? 'Pause new sign-ups' : 'Open sign-ups'}</button>
        <button className="ghost danger" type="button" disabled={busy} onClick={() => {
          if (confirm('Make a new QR key? Every party QR code printed so far stops letting new players in (phones already in are fine). Reprint the sheet afterwards.')) save({ newKey: true }, 'New QR key. Reprint the QR sheet.');
        }}>New QR key</button>
      </div>
    </section>
  );
}

function HelpCard({ run, busy }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => hostAccess.help().then(r => { setList(r || []); setErr(''); }).catch(e => setErr(e.message)), []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);
  const open = list?.filter(x => !x.handled_at).length ?? 0;
  const mark = (id, done) => run(async () => { await hostAccess.helpDone(id, done); await load(); });
  return (
    <section className="card access-card">
      <div className="row spread">
        <h2>Help requests<span className={`help-badge${open ? '' : ' zero'}`} aria-label={`${open} new`}>{open}</span></h2>
        <button className="ghost" type="button" disabled={busy} onClick={load}>Refresh</button>
      </div>
      <p className="muted small">From the "Need help?" form on the landing page. Nothing is emailed: reply yourself.</p>
      {err && <p className="muted small">Couldn't load: {err}</p>}
      {list && !list.length && <p className="muted small">No messages yet.</p>}
      {!!list?.length && (
        <ul className="help-list">
          {list.slice(0, 20).map(h => (
            <li key={h.id} className={`help-item${h.handled_at ? ' done' : ''}`}>
              <div>
                <div className="help-meta"><b>{h.name}</b>{h.contact ? ` · ${h.contact}` : ''} · {new Date(h.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                <p>{h.message}</p>
              </div>
              <button className="ghost" type="button" disabled={busy} onClick={() => mark(h.id, !h.handled_at)}>{h.handled_at ? 'Reopen' : 'Done'}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
