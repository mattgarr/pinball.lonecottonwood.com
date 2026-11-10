import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { getHostPass, host, useParty } from '../lib/store.js';
import Avatar from '../components/Avatar.jsx';
import QR from '../components/QR.jsx';

// Host guest manager: the guest list for one event, with contact info, payment, RSVP, invite and
// sign-up status. Deliberately plain, modern styling (not 8-bit): this is an admin tool.
const SITE = 'https://pinball.lonecottonwood.com';
const RSVP = { yes: 'Yes', maybe: 'Maybe', no: 'No' };
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'paid', label: 'Paid' },
  { id: 'unpaid', label: 'Not paid' },
  { id: 'joined', label: 'Signed up' },
  { id: 'notjoined', label: 'Not signed up' },
  { id: 'unsent', label: 'Not emailed' },
  { id: 'bounced', label: 'Bounced' },
];
const blank = { name: '', email: '', phone: '', party_size: 1, paid: false, rsvp: '', notes: '' };
const when = d => (d ? new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');
// "Emailed" means they got the first email that fits them now: paid = sign-up QR, unpaid = invite.
// (Same rule the server uses for "Send to people not emailed yet".)
// People on someone else's ticket signed up from that ticket's link: they count as covered.
const emailedAt = g => (g.parent_id || !g.email ? g.created_at : g.paid ? g.register_sent_at : g.invited_at);
const emailedLabel = g => (g.paid ? (g.register_sent_at ? `QR sent ${when(g.register_sent_at)}` : null) : (g.invited_at ? `Invite sent ${when(g.invited_at)}` : null));
const nameOf = g => g.name || g.email;
// Set by the resend-alerts function when an email to them bounces or is marked as spam.
const bounceLabel = g => (g.bounce_at ? `${g.bounce_kind === 'spam' ? 'Marked spam' : 'Bounced'} ${when(g.bounce_at)}` : null);
const AUDIENCES = [
  { id: 'paid', label: 'Paid guests', keep: g => g.paid },
  { id: 'going', label: "Paid, except RSVP'd no", keep: g => g.paid && g.rsvp !== 'no' },
  { id: 'all', label: 'Everyone on the list (incl. unpaid)', keep: () => true },
];

export default function HostGuests() {
  const { events, party } = useParty();
  const [params, setParams] = useSearchParams();
  const eventId = Number(params.get('event')) || party?.current_event_id || events[0]?.id;
  const event = events.find(e => e.id === eventId);
  const [guests, setGuests] = useState(null);
  const [walkins, setWalkins] = useState(null); // players who joined without a ticket link
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [editing, setEditing] = useState(null); // guest object or blank for "add"
  const [qrGuest, setQrGuest] = useState(null); // guest object whose sign-up QR modal is open
  const [pasting, setPasting] = useState(false);
  const [composing, setComposing] = useState(false);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => eventId && Promise.all([
    host.invites(eventId).then(setGuests).catch(e => flash(`⚠ ${e.message}`)),
    host.walkins(eventId).then(setWalkins),
  ]);
  useEffect(() => { setGuests(null); setWalkins(null); load(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  function flash(t) { setToast(t); clearTimeout(flash.t); flash.t = setTimeout(() => setToast(''), 3500); }
  async function act(fn, done) {
    setBusy(true);
    try { const r = await fn(); if (done) flash(typeof done === 'function' ? done(r) : done); await load(); return r; }
    catch (e) { flash(`⚠ ${e.message}`); }
    finally { setBusy(false); }
  }

  const list = guests || [];
  const walk = walkins || [];
  // People who came on each ticket (rows with parent_id), by the ticket's row id.
  const kidsOf = useMemo(() => {
    const m = new Map();
    list.forEach(g => { if (g.parent_id) m.set(g.parent_id, [...(m.get(g.parent_id) || []), g]); });
    return m;
  }, [list]);
  const byId = useMemo(() => new Map(list.map(g => [g.id, g])), [list]);
  // Someone on another guest's ticket shares that ticket's link.
  const linkOf = g => `${SITE}/join?invite=${(g.parent_id && byId.get(g.parent_id)?.token) || g.token}`;
  // A ticket's party size never goes below the number of people who actually signed up on it.
  const partyOf = g => Math.max(g.party_size || 1, 1 + (kidsOf.get(g.id)?.length || 0));
  const stats = useMemo(() => ({
    guests: list.length,
    people: list.filter(g => !g.parent_id).reduce((n, g) => n + partyOf(g), 0),
    paid: list.filter(g => g.paid).length,
    yes: list.filter(g => g.rsvp === 'yes').length,
    maybe: list.filter(g => g.rsvp === 'maybe').length,
    no: list.filter(g => g.rsvp === 'no').length,
    joined: list.filter(g => g.player_id).length,
    unsent: list.filter(g => !emailedAt(g)).length,
    bounced: list.filter(g => g.bounce_at).length,
  }), [list, kidsOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const keep = g => ({
      all: true, paid: g.paid, unpaid: !g.paid, joined: !!g.player_id, notjoined: !g.player_id, unsent: !emailedAt(g), bounced: !!g.bounce_at,
    }[filter]);
    const val = g => ({
      name: (g.name || g.email).toLowerCase(), party: g.parent_id ? 0 : partyOf(g), paid: g.paid ? 1 : 0, rsvp: g.rsvp || 'zz',
      emailed: emailedAt(g) || '', joined: g.player_id ? 1 : 0, games: g.games || 0,
    }[sort.key]);
    const arr = list
      .filter(g => keep(g) && (!t || [g.name, g.email, g.phone, g.player_name, g.notes, g.parent_name].some(x => (x || '').toLowerCase().includes(t))))
      .sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
    // People who came together stay together: each ticket's extra people go right under it.
    const ids = new Set(arr.map(g => g.id));
    const under = g => g.parent_id && ids.has(g.parent_id);
    const out = [];
    const add = g => { out.push(g); arr.filter(k => k.parent_id === g.id).sort((a, b) => a.id - b.id).forEach(add); };
    arr.forEach(g => { if (!under(g)) add(g); });
    return out.map(g => ({ g, under: under(g) }));
  }, [list, q, filter, sort, kidsOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownWalkins = useMemo(() => {
    const t = q.trim().toLowerCase();
    return filter === 'all' || filter === 'joined' ? walk.filter(p => !t || p.name.toLowerCase().includes(t)) : [];
  }, [walk, q, filter]);

  if (!getHostPass()) return <Navigate to="/host" replace />;

  const setPaid = g => act(async () => {
    await host.saveGuest(eventId, { ...g, paid: !g.paid, rsvp: !g.paid && !g.rsvp ? 'yes' : g.rsvp });
    if (!g.paid && !g.player_id && !g.register_sent_at
      && confirm(`Marked ${nameOf(g)} as paid.\n\nEmail them their sign-up QR now? (You can also do it later with the Email button.)`)) {
      await host.emailRoster({ eventId, kind: 'register', audience: 'all', inviteIds: [g.id] });
      return 'sent';
    }
  }, r => (r === 'sent' ? `Marked paid and emailed ${nameOf(g)} their QR.` : `${nameOf(g)}: ${g.paid ? 'not paid' : 'paid'}.`));
  const setRsvp = (g, rsvp) => act(() => host.saveGuest(eventId, { ...g, rsvp }), `RSVP updated.`);
  const copyLink = async g => {
    const url = linkOf(g);
    try { await navigator.clipboard.writeText(url); flash(`Copied ${nameOf(g)}'s sign-up link. Paste it into a text to them.`); }
    catch { prompt(`Copy ${nameOf(g)}'s sign-up link:`, url); }
  };
  const emailOne = g => {
    if (!g.paid && !event?.ticket_url) { flash('⚠ Add a ticket link first (Email guests…): unpaid guests need it.'); return; }
    const what = g.paid ? 'their sign-up QR' : 'the invite with the ticket link';
    const before = emailedAt(g) ? `\n\nHeads up: they already got this on ${when(emailedAt(g))}. Send it again?` : '';
    if (!confirm(`Email ${nameOf(g)} ${what}?${before}`)) return;
    act(() => host.emailRoster({ eventId, kind: 'auto', audience: 'all', inviteIds: [g.id] }), `Email sent to ${g.email}.`);
  };
  const remove = g => {
    if (!confirm(`Remove ${g.name || g.email} from the guest list?`)) return;
    act(() => host.removeInvite(g.id), 'Guest removed.');
    setEditing(null);
  };
  const sortBy = key => setSort(s => ({ key, dir: s.key === key ? -s.dir : 1 }));
  const Th = ({ k, children, className }) => (
    <th className={className}><button type="button" onClick={() => sortBy(k)} className={sort.key === k ? 'on' : ''}>
      {children}{sort.key === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>
  );

  function exportCsv() {
    const cols = ['Name', 'Email', 'Phone', 'Party size', 'Paid', 'RSVP', 'Emailed', 'Signed up as', 'Games', 'On ticket of', 'Notes', 'Join link'];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = list.map(g => [g.name, g.email, g.phone, g.parent_id ? '' : partyOf(g), g.paid ? 'yes' : 'no', g.rsvp || '', emailedAt(g) ? when(emailedAt(g)) : '',
      g.player_name || '', g.games || 0, g.parent_name || '', g.notes || '', linkOf(g)].map(esc).join(','));
    const walkRows = walk.map(p => [p.name, '', '', '', '', '', '', p.name, p.games || 0, '', 'Joined at the party (no ticket link)', ''].map(esc).join(','));
    const blob = new Blob([[cols.map(esc).join(','), ...rows, ...walkRows].join('\n')], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${(event?.name || 'guests').replace(/\W+/g, '-')}-guests.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div className="gm">
      <div className="gm-head">
        <div>
          <Link to="/host" className="gm-back">← Host &amp; events</Link>
          <h1>Guests</h1>
          <div className="gm-event-bar">
            {events.length > 1 ? (
              <select value={eventId || ''} onChange={e => setParams({ event: e.target.value })} className="gm-event">
                {events.map(e => <option key={e.id} value={e.id}>{e.name}{e.id === party?.current_event_id ? ' (active)' : ''}</option>)}
              </select>
            ) : <div className="gm-sub">{event?.name}{event?.id === party?.current_event_id ? ' (active event)' : ''}</div>}
            <Link to="/host" className="gm-manage-events">Switch / + New event →</Link>
          </div>
        </div>
        <div className="gm-actions">
          <button type="button" className="gm-btn" onClick={exportCsv} disabled={!list.length}>Export CSV</button>
          <button type="button" className="gm-btn" onClick={() => setPasting(true)}>Paste list</button>
          <button type="button" className="gm-btn" onClick={() => setComposing(true)} disabled={!list.length}>✉ Email guests…</button>
          <button type="button" className="gm-btn gm-primary" onClick={() => setEditing({ ...blank })}>+ Add guest</button>
        </div>
      </div>

      <div className="gm-stats">
        <Stat n={stats.guests} label="guests" />
        <Stat n={stats.people} label="people" />
        <Stat n={stats.paid} of={stats.guests} label="paid" tone="green" />
        <Stat n={stats.yes} label="RSVP yes" tone="green" sub={stats.maybe || stats.no ? `${stats.maybe} maybe · ${stats.no} no` : null} />
        <Stat n={stats.joined + walk.length} label="playing" tone="blue" sub={walk.length ? `incl. ${walk.length} joined at the party` : null} />
        <Stat n={stats.unsent} label="not emailed" tone={stats.unsent ? 'amber' : null} />
        {stats.bounced > 0 && <Stat n={stats.bounced} label="bounced" tone="red" />}
      </div>

      <div className="gm-tools">
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, phone, notes…" className="gm-search" />
        <div className="gm-filters">
          {FILTERS.filter(f => f.id !== 'bounced' || stats.bounced).map(f => (
            <button key={f.id} type="button" className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
      </div>

      {guests === null ? <div className="gm-empty">Loading…</div>
        : !shown.length ? <div className="gm-empty">{list.length ? 'No guests match.' : 'No guests yet. Add one or paste a list.'}</div>
        : (
          <div className="gm-table-wrap">
            <table className="gm-table">
              <thead><tr>
                <Th k="name">Guest</Th><th>Phone</th><Th k="party" className="num">Party</Th><Th k="paid">Paid</Th>
                <Th k="rsvp">RSVP</Th><Th k="emailed">Emailed</Th><Th k="joined">Signed up</Th><Th k="games" className="num">Games</Th><th />
              </tr></thead>
              <tbody>
                {shown.map(({ g, under }) => (
                  <tr key={g.id} className={under ? 'gm-kid' : kidsOf.has(g.id) ? 'gm-has-kids' : ''}>
                    <td className="gm-who" onClick={() => setEditing(g)}>
                      <div className="gm-name">{under && <span className="gm-kid-arrow" aria-hidden>↳</span>}{g.name || <span className="gm-dim">No name</span>}</div>
                      {g.email && <a href={`mailto:${g.email}`} onClick={e => e.stopPropagation()} className="gm-email">{g.email}</a>}
                      {g.parent_id && <div className="gm-email gm-dim">On {g.parent_name || 'another guest'}'s ticket</div>}
                      {kidsOf.has(g.id) && <div className="gm-with">+ {kidsOf.get(g.id).map(k => k.name || k.player_name).join(', ')}</div>}
                      {g.notes && <div className="gm-note">{g.notes}</div>}
                    </td>
                    <td data-label="Phone">{g.phone ? <a href={`tel:${g.phone.replace(/[^\d+]/g, '')}`}>{g.phone}</a> : <span className="gm-dim">-</span>}</td>
                    <td data-label="Party" className="num">{g.parent_id ? <span className="gm-dim">-</span> : partyOf(g)}</td>
                    <td data-label="Paid"><Switch on={g.paid} disabled={busy} onChange={() => setPaid(g)} /></td>
                    <td data-label="RSVP">
                      <select className={`gm-rsvp ${g.rsvp || 'none'}`} value={g.rsvp || ''} disabled={busy} onChange={e => setRsvp(g, e.target.value || null)}>
                        <option value="">No reply</option>
                        {Object.entries(RSVP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td data-label="Emailed">
                      {bounceLabel(g) && <div><span className="gm-pill bad" title={g.bounce_note || 'Fix their email address, then resend.'}>⚠ {bounceLabel(g)}</span></div>}
                      {g.parent_id || !g.email ? <span className="gm-pill">Shared ticket</span>
                        : emailedLabel(g) ? <span className="gm-pill ok">{emailedLabel(g)}</span> : <span className="gm-pill">Not yet</span>}
                      {g.update_sent_at && <div className="gm-dim gm-small">Update {when(g.update_sent_at)}</div>}
                    </td>
                    <td data-label="Signed up">
                      {g.player_id ? (
                        <span className="gm-player"><Avatar avatar={g.player_avatar} emoji={g.player_emoji} name={g.player_name} size={22} />{g.player_name}{g.who && !g.parent_id && <span className="gm-dim"> ({g.who.split(' ')[0]})</span>}</span>
                      ) : <span className="gm-dim">-</span>}
                    </td>
                    <td data-label="Games" className="num">{g.games || <span className="gm-dim">0</span>}</td>
                    <td className="gm-row-actions">
                      <button type="button" disabled={!g.paid} title="Show scannable sign-up QR code on screen" onClick={() => setQrGuest(g)}>Show QR</button>
                      <button type="button" disabled={!g.paid} title={g.parent_id ? `Copies ${g.parent_name || 'the original guest'}'s ticket link (everyone on a ticket shares it)` : g.paid ? 'Copy their personal sign-up link (to text it to them)' : 'Mark them paid first: sign-up links are only for confirmed tickets'} onClick={() => copyLink(g)}>Copy link</button>
                      <button type="button" title={g.paid ? 'Email their sign-up QR' : 'Email the invite with the ticket link'} onClick={() => emailOne(g)} disabled={busy || !g.email}>{g.paid ? 'Email QR' : 'Email invite'}</button>
                      <button type="button" onClick={() => setEditing(g)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {shownWalkins.length > 0 && (
        <section className="gm-walkins">
          <h2>Joined at the party <span className="gm-dim">({shownWalkins.length})</span></h2>
          <p className="gm-dim gm-small">Signed up without a ticket link (for example, by scanning a machine's QR code). They're playing either way. If you know whose ticket they're on, pick it and they'll show up with that guest.</p>
          <ul>
            {shownWalkins.map(p => (
              <li key={p.id}>
                <Avatar avatar={p.avatar} emoji={p.emoji} name={p.name} size={28} />
                <span className="gm-walk-name">{p.name}</span>
                <span className="gm-dim gm-small">{p.games || 0} game{p.games === 1 ? '' : 's'}</span>
                <select className="gm-walk-link" value="" disabled={busy} aria-label={`Add ${p.name} to a ticket`}
                  onChange={e => {
                    const g = byId.get(Number(e.target.value));
                    if (g) act(() => host.linkPlayer(eventId, p.id, g.id),
                      r => (r === 'linked' ? `${p.name} is now signed up as ${nameOf(g)}.` : `${p.name} added to ${nameOf(g)}'s ticket.`));
                  }}>
                  <option value="">Add to a ticket…</option>
                  {list.filter(g => !g.parent_id).sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map(g => (
                    <option key={g.id} value={g.id}>{nameOf(g)}{g.player_id ? ` (with ${g.player_name})` : ''}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      {qrGuest && (
        <Modal title={`${nameOf(qrGuest)} — Sign-up QR`} onClose={() => setQrGuest(null)}>
          <div style={{ display: 'grid', justifyItems: 'center', gap: 12, padding: '8px 0', textAlign: 'center' }}>
            <div className="gm-dim">Scan with a phone camera to set up {nameOf(qrGuest)}&apos;s player account for <b>{event?.name}</b>:</div>
            <div style={{ background: '#fff', padding: 12, borderRadius: 12 }}>
              <QR value={linkOf(qrGuest)} size={220} />
            </div>
            <div className="gm-small gm-dim" style={{ wordBreak: 'break-all' }}>{linkOf(qrGuest)}</div>
            <div className="gm-form-actions" style={{ width: '100%' }}>
              <span className="gm-grow" />
              <button type="button" className="gm-btn" onClick={() => copyLink(qrGuest)}>Copy sign-up link</button>
              <button type="button" className="gm-btn gm-primary" onClick={() => setQrGuest(null)}>Done</button>
            </div>
          </div>
        </Modal>
      )}
      {editing && <GuestForm guest={editing} busy={busy} onClose={() => setEditing(null)} onRemove={editing.id ? () => remove(editing) : null}
        onSave={g => act(async () => { await host.saveGuest(eventId, g); setEditing(null); }, g.id ? 'Guest saved.' : 'Guest added.')} />}
      {pasting && <PasteForm busy={busy} onClose={() => setPasting(false)}
        onAdd={(text, paid) => act(async () => { const n = await host.addInvites(eventId, text, paid); setPasting(false); return n; }, n => `Added ${n} guest${n === 1 ? '' : 's'}.`)} />}
      {composing && <Composer event={event} guests={list.filter(g => g.email)} busy={busy} onClose={() => setComposing(false)}
        onTicketUrl={url => host.setTicketUrl(eventId, url)}
        onSend={(opts) => act(async () => { const r = await host.emailRoster({ eventId, ...opts }); if (!opts.testTo) setComposing(false); return r; },
          r => (r?.test ? `Sample sent to ${opts.testTo}. Check your inbox.` : `Sent to ${r?.sent ?? 0} guest${r?.sent === 1 ? '' : 's'}.`))} /> }

      {toast && <div className={`gm-toast${toast.startsWith('⚠') ? ' err' : ''}`}>{toast}</div>}
    </div>
  );
}

function Stat({ n, of, label, tone, sub }) {
  return (
    <div className={`gm-stat ${tone || ''}`}>
      <div className="gm-stat-n">{n}{of != null && <span>/{of}</span>}</div>
      <div className="gm-stat-l">{label}</div>
      {sub && <div className="gm-stat-sub">{sub}</div>}
    </div>
  );
}

function Switch({ on, onChange, disabled }) {
  return <button type="button" role="switch" aria-checked={on} className={`gm-switch${on ? ' on' : ''}`} onClick={onChange} disabled={disabled}><span /></button>;
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="gm-modal-bg" onClick={onClose}>
      <div className="gm-modal" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="gm-modal-head"><h2>{title}</h2><button type="button" className="gm-x" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

function GuestForm({ guest, busy, onSave, onClose, onRemove }) {
  const [g, setG] = useState({ ...guest, rsvp: guest.rsvp || '' });
  const set = (k, v) => setG(x => ({ ...x, [k]: v }));
  return (
    <Modal title={guest.id ? 'Edit guest' : 'Add guest'} onClose={onClose}>
      <form className="gm-form" onSubmit={e => { e.preventDefault(); onSave({ ...g, rsvp: g.rsvp || null }); }}>
        <label>Name<input value={g.name || ''} onChange={e => set('name', e.target.value)} placeholder="e.g. Chris and Cina Boitnott" autoFocus /></label>
        <label>Email<input type="email" required={!guest.parent_id} value={g.email || ''} onChange={e => set('email', e.target.value)} placeholder="name@example.com" />
          <span className="gm-hint">{guest.parent_id
            ? `Shares ${guest.parent_name || 'another guest'}'s ticket. Email is optional: add one to include them in reminder emails.`
            : "One row per email. Everyone on a ticket can use the same sign-up link or QR; each extra person gets their own row here."}</span></label>
        <div className="gm-form-row">
          <label>Phone<input value={g.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="(650) 555-0100" /></label>
          <label className="gm-narrow">Party size<input type="number" min="1" max="20" value={g.party_size} onChange={e => set('party_size', e.target.value)} /></label>
        </div>
        <div className="gm-form-row">
          <label className="gm-check"><input type="checkbox" checked={!!g.paid} onChange={e => set('paid', e.target.checked)} /> Paid</label>
          <label>RSVP
            <select value={g.rsvp} onChange={e => set('rsvp', e.target.value)}>
              <option value="">No reply</option>{Object.entries(RSVP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <label>Notes<textarea rows={3} value={g.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Private to hosts" /></label>
        {guest.id && (
          <div className="gm-meta">
            {guest.player_id ? <>Signed up as <b>{guest.player_name}</b> · {guest.games || 0} games</> : 'Not signed up yet'}
            {emailedLabel(guest) ? ` · ${emailedLabel(guest)}` : ' · not emailed yet'}
          </div>
        )}
        {guest.bounce_at && (
          <div className="gm-meta gm-bad">
            ⚠ {bounceLabel(guest)}{guest.bounce_note ? `: ${guest.bounce_note}` : ''}. {guest.bounce_kind === 'spam'
              ? 'They marked our email as spam. Maybe text them instead.'
              : 'Fix the email address and save, then use the email button on their row to resend.'}
          </div>
        )}
        <div className="gm-form-actions">
          {onRemove && <button type="button" className="gm-btn danger" onClick={onRemove} disabled={busy}>Remove</button>}
          <span className="gm-grow" />
          <button type="button" className="gm-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="gm-btn gm-primary" disabled={busy || (!g.email && !guest.parent_id)}>{guest.id ? 'Save' : 'Add guest'}</button>
        </div>
      </form>
    </Modal>
  );
}

function PasteForm({ busy, onAdd, onClose }) {
  const [text, setText] = useState('');
  const [paid, setPaid] = useState(false);
  const n = text.split(/[\n;]+/).filter(l => /\S+@\S+\.\S+/.test(l)).length;
  return (
    <Modal title="Paste a guest list" onClose={onClose}>
      <form className="gm-form" onSubmit={e => { e.preventDefault(); onAdd(text, paid); }}>
        <label>One guest per line<textarea rows={8} value={text} onChange={e => setText(e.target.value)} autoFocus
          placeholder={'Fran Flipper <fran@example.com>\nTom Tilt, tom@example.com\nmax@example.com'} /></label>
        <label className="gm-check"><input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} /> They've already paid</label>
        <div className="gm-meta">Nothing is emailed when you add guests. Anyone already on the list is updated, not added twice.</div>
        <div className="gm-form-actions"><span className="gm-grow" />
          <button type="button" className="gm-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="gm-btn gm-primary" disabled={busy || !n}>Add {n || ''} guest{n === 1 ? '' : 's'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Composer({ event, guests, busy, onSend, onTicketUrl, onClose }) {
  const unsent = guests.filter(g => !emailedAt(g));
  const [kind, setKind] = useState(unsent.length ? 'auto' : 'reminder');
  const [aud, setAud] = useState('paid');
  const [note, setNote] = useState('');
  const [subject, setSubject] = useState('');
  const [testTo, setTestTo] = useState('');
  const [ticket, setTicket] = useState(event?.ticket_url || '');
  // Bulk sends skip addresses that bounced (send to them one at a time from their row if fixed).
  const to = (kind === 'auto' ? unsent : guests.filter(AUDIENCES.find(a => a.id === aud).keep)).filter(g => !g.bounce_at);
  const unpaid = to.filter(g => !g.paid).length;
  const needTicket = kind === 'auto' && unpaid > 0 && !ticket.trim();
  const plural = n => `${n} guest${n === 1 ? '' : 's'}`;
  const names = to.map(nameOf);
  // Save a changed ticket link before sending, so it's never lost.
  const saveTicket = async () => { if (ticket.trim() !== (event?.ticket_url || '')) await onTicketUrl(ticket.trim()); };
  const opts = { kind, audience: kind === 'auto' ? 'unsent' : aud, subject, message: note };
  return (
    <Modal title="Email guests" onClose={onClose}>
      <div className="gm-form">
        <div className="gm-choice">
          <label className={kind === 'auto' ? 'on' : ''}><input type="radio" checked={kind === 'auto'} onChange={() => setKind('auto')} />
            <div><b>First email</b> to the {plural(unsent.length)} not emailed yet
              <small>Paid guests get "You're in!" with their personal sign-up QR. Unpaid guests get an invite with the ticket link. Nobody gets it twice.</small></div></label>
          <label className={kind === 'reminder' ? 'on' : ''}><input type="radio" checked={kind === 'reminder'} onChange={() => setKind('reminder')} />
            <div><b>News update</b> (e.g. "See you Saturday!")
              <small>Days to go, the machines, how it works, plus your note. Sends even if they've had emails before.</small></div></label>
        </div>
        {kind === 'reminder' && (
          <label>Who gets it
            <select value={aud} onChange={e => setAud(e.target.value)}>
              {AUDIENCES.map(a => <option key={a.id} value={a.id}>{a.label} ({guests.filter(a.keep).length})</option>)}
            </select>
          </label>
        )}
        <div className="gm-meta">
          {to.length ? <>Goes to {names.slice(0, 6).join(', ')}{names.length > 6 ? ` and ${names.length - 6} more` : ''}.</> : 'Nobody to send to.'}
          {kind === 'auto' && unpaid > 0 && <> {unpaid} of them haven't paid and will get the ticket link.</>}
        </div>
        <label>Subject <span className="gm-dim">(optional: leave blank and we'll write one)</span><input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. See you Saturday!" /></label>
        <label>Your note <span className="gm-dim">(optional, shows near the top)</span><textarea rows={4} value={note} onChange={e => setNote(e.target.value)} placeholder="Start time, parking, what to bring…" /></label>
        {kind === 'auto' && (
          <label>Ticket link for unpaid guests<input type="url" value={ticket} onChange={e => setTicket(e.target.value)} placeholder="https://…" />
            {needTicket && <span className="gm-hint warn">Add the ticket link: {unpaid} unpaid guest{unpaid === 1 ? '' : 's'} need it.</span>}</label>
        )}
        <div className="gm-form-row">
          <label>Send yourself a sample first<input type="email" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@example.com" />
            <span className="gm-hint">Uses a made-up "Sample Guest"{kind === 'auto' ? ' and sends both versions (paid and unpaid)' : ''}. No guest gets anything.</span></label>
          <button type="button" className="gm-btn gm-align-end" disabled={busy || !testTo.trim()}
            onClick={async () => { await saveTicket(); onSend({ ...opts, testTo: testTo.trim() }); }}>Send sample</button>
        </div>
        <div className="gm-form-actions"><span className="gm-grow" />
          <button type="button" className="gm-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="gm-btn gm-primary" disabled={busy || !to.length || needTicket} onClick={async () => {
            if (!confirm(`Send the ${kind === 'auto' ? 'first email' : 'news update'} to ${plural(to.length)} now? This can't be undone.`)) return;
            // Send exactly the people listed here (the server would otherwise pick its own list).
            await saveTicket(); onSend({ ...opts, inviteIds: to.map(g => g.id) });
          }}>Send to {plural(to.length)}</button>
        </div>
      </div>
    </Modal>
  );
}
