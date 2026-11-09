import { useEffect, useState } from 'react';
import { host } from '../lib/store.js';

const SITE = 'https://pinball.lonecottonwood.com';

// Host: one event's guest list. Kept deliberately simple:
//  - each guest has a PAID box (tick it when they buy)
//  - SEND INVITES: everyone who hasn't had theirs gets the right email
//      paid   -> "You're in!" + QR code to set up their player
//      unpaid -> invite + "get tickets" link
//  - SEND UPDATE: countdown + your note, to everyone
export default function HostRoster({ event, run, busy }) {
  const [list, setList] = useState(null);
  const [paste, setPaste] = useState('');
  const [pastePaid, setPastePaid] = useState(true);
  const [ticketUrl, setTicketUrl] = useState(event.ticket_url || '');
  const [note, setNote] = useState('');
  const [testTo, setTestTo] = useState('');

  const load = () => host.invites(event.id).then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const guests = list || [];
  const paid = guests.filter(g => g.paid).length;
  const joined = guests.filter(g => g.player_id).length;
  const unsent = guests.filter(g => (g.paid ? !g.register_sent_at : !g.invited_at)).length;
  const test = testTo.trim();

  const status = g => (g.player_id ? `✓ ${g.player_name || 'signed up'}` : (g.paid ? g.register_sent_at : g.invited_at) ? 'emailed' : 'not emailed');

  function togglePaid(g) {
    const nowPaid = !g.paid;
    run(async () => {
      await host.setInvitePaid(g.id, nowPaid);
      let sent = false;
      if (nowPaid && !g.player_id && confirm(`${g.name || g.email} is paid. Email them their sign-up link + QR now?`)) {
        await host.emailRoster({ eventId: event.id, kind: 'register', audience: 'all', inviteIds: [g.id] });
        sent = true;
      }
      await load();
      return sent;
    }, sent => (sent ? `Sign-up email sent to ${g.name || g.email}.` : `${g.name || g.email}: ${nowPaid ? 'paid' : 'not paid'}.`));
  }

  function sendInvites() {
    if (!test && !confirm(`Send invites to ${unsent} guest${unsent === 1 ? '' : 's'}?\nPaid guests get their sign-up QR; the rest get the invite + ticket link.`)) return;
    run(async () => { const r = await host.emailRoster({ eventId: event.id, kind: 'auto', audience: 'unsent', testTo: test || null }); await load(); return r; },
      r => (r?.test ? `Test invite sent to ${test}.` : `Invites sent to ${r?.sent ?? 0}.`));
  }

  function sendUpdate() {
    if (!test && !confirm(`Send the update to all ${guests.length} guests?`)) return;
    run(() => host.emailRoster({ eventId: event.id, kind: 'reminder', audience: 'all', message: note, testTo: test || null }),
      r => (r?.test ? `Test update sent to ${test}.` : `Update sent to ${r?.sent ?? 0}.`));
  }

  return (
    <div className="roster">
      <div className="roster-head">{list ? `${guests.length} guest${guests.length === 1 ? '' : 's'} · ${paid} paid · ${joined} signed up` : 'Loading…'}</div>

      <form className="roster-add" onSubmit={e => {
        e.preventDefault();
        if (!paste.trim()) return;
        run(async () => { const k = await host.addInvites(event.id, paste, pastePaid); setPaste(''); await load(); return k; }, k => `Added ${k} guest${k === 1 ? '' : 's'}.`);
      }}>
        <textarea rows={3} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Add guests, one per line:\nFran Flipper <fran@example.com>'} />
        <label className="field row"><input type="checkbox" checked={pastePaid} onChange={e => setPastePaid(e.target.checked)} /><span>They already have tickets</span></label>
        <button className="ghost" disabled={busy || !paste.trim()} type="submit">Add guests</button>
      </form>

      {guests.length > 0 && (
        <ul className="roster-list">
          {guests.map(g => (
            <li key={g.id}>
              <label className="roster-paid" title="Paid"><input type="checkbox" checked={g.paid} disabled={busy} onChange={() => togglePaid(g)} /><span>Paid</span></label>
              <span className="roster-who">{g.name || g.email}<span className={`roster-st${g.player_id ? ' ok' : ''}`}>{status(g)}</span></span>
              <button className="row-x" type="button" title="Copy their personal link" aria-label={`Copy link for ${g.email}`}
                onClick={() => { navigator.clipboard?.writeText(`${SITE}/join?invite=${g.token}`); }}>⧉</button>
              <button className="row-x" type="button" aria-label={`Remove ${g.email}`} disabled={busy}
                onClick={() => { if (confirm(`Remove ${g.name || g.email}?`)) run(async () => { await host.removeInvite(g.id); await load(); }); }}>✕</button>
            </li>
          ))}
        </ul>
      )}

      <div className="roster-ticket">
        <input type="url" value={ticketUrl} onChange={e => setTicketUrl(e.target.value)} placeholder="Ticket link (for unpaid invites)" />
        <button className="ghost" type="button" disabled={busy || ticketUrl.trim() === (event.ticket_url || '')}
          onClick={() => run(() => host.setTicketUrl(event.id, ticketUrl.trim()), 'Ticket link saved.')}>Save</button>
      </div>

      <div className="roster-send">
        <button className="primary" type="button" disabled={busy || (!unsent && !test)} onClick={sendInvites}>
          {test ? 'Send test invite' : `Send invites (${unsent})`}
        </button>
        <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Update note (optional): start time, parking, what to bring…" />
        <button className="ghost" type="button" disabled={busy || (!guests.length && !test)} onClick={sendUpdate}>
          {test ? 'Send test update' : 'Send update to everyone'}
        </button>
        <input type="email" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Test first? Your email here" />
      </div>
    </div>
  );
}
