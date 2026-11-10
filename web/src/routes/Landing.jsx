import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PinballIcon from '../components/PinballIcon.jsx';
import PixelEmoji from '../components/PixelEmoji.jsx';
import { checkAccess, sendHelp, setAccess } from '../lib/access.js';
import { useParty } from '../lib/store.js';
import '../landing.css';

// What strangers see: a marquee, a way in with the party password, "I already joined", and a help form.
// onIn: called once this browser is let in (the parent re-renders into the app).
export default function Landing({ onIn, notice = '' }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(notice);
  const [help, setHelp] = useState(false);
  const { event } = useParty();
  useEffect(() => { if (notice) setErr(notice); }, [notice]);
  const when = event?.starts_on ? new Date(`${event.starts_on}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '') : '';

  async function enter(e) {
    e.preventDefault();
    const c = code.trim();
    if (!c) { setErr('Type the party password.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await checkAccess(c);
      if (!r.ok) { setErr(r.error || "That password isn't right."); return; }
      setAccess(c);
      onIn?.();
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="landing">
      <header className="landing-top">
        <span className="landing-mark"><PinballIcon size={24} /></span>
        <span className="landing-word">Woodside Pinball</span>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-logo"><PinballIcon size={72} /></div>
        <h1 id="landing-title" className="landing-title">The Ultimate<br />Woodside Pinball<br />Tournament</h1>
        <p className="landing-kicker">Private party{when ? ` · ${when}` : ''}</p>
        <p className="landing-lede">
          The live leaderboard for one night of pinball with friends: six machines, a score camera, a big
          board on the TV, and prizes at the end of the night.
        </p>
        <div className="landing-coin" aria-hidden="true">Insert coin</div>
      </section>

      <form className="landing-card" onSubmit={enter} aria-labelledby="code-title">
        <h2 id="code-title">Have a party code?</h2>
        <p className="landing-help">Scan the party QR code, or type the password a host gives you.</p>
        <label className="landing-field">
          <span>Party password</span>
          <input value={code} onChange={e => { setCode(e.target.value); setErr(''); }} placeholder="e.g. silver flipper 42"
            autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={60} enterKeyHint="go" />
        </label>
        {err && <div className="landing-err" role="alert">{err}</div>}
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Let me in'}</button>
      </form>

      <section className="landing-card" aria-labelledby="back-title">
        <h2 id="back-title">Already joined?</h2>
        <p className="landing-help">Sign back in with your nickname and PIN. Got a "You're in!" email? Tap its button to sign up.</p>
        <Link className="secondary landing-btn" to="/rejoin">I already joined</Link>
      </section>

      <section className="landing-card" aria-labelledby="help-title">
        <h2 id="help-title">Need help?</h2>
        {!help ? (
          <>
            <p className="landing-help">Can't get in, lost your PIN, or a question for the hosts? Send a note.</p>
            <button type="button" className="secondary landing-btn" onClick={() => setHelp(true)}>Contact the hosts</button>
          </>
        ) : <HelpForm onClose={() => setHelp(false)} />}
      </section>

      <footer className="landing-foot">
        <PixelEmoji e="🕹️" size={16} grid={14} /> Invite only. Guests get in with a ticket link, the party QR code or the party password.
      </footer>
    </div>
  );
}

function HelpForm({ onClose }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  async function send(e) {
    e.preventDefault();
    if (!name.trim() || !message.trim()) { setErr('Add your name and a message.'); return; }
    setBusy(true); setErr('');
    try { await sendHelp({ name: name.trim(), contact: contact.trim(), message: message.trim() }); setSent(true); }
    catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  }

  if (sent) {
    return (
      <div className="landing-sent" role="status">
        <p><strong>Got it!</strong> A host will see your note{contact.trim() ? ' and get back to you' : ''}.</p>
        <button type="button" className="secondary landing-btn" onClick={onClose}>Done</button>
      </div>
    );
  }
  return (
    <form className="landing-help-form" onSubmit={send}>
      <label className="landing-field">
        <span>Your name</span>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={80} autoComplete="name" autoCapitalize="words" />
      </label>
      <label className="landing-field">
        <span>Email or phone (so we can reply)</span>
        <input value={contact} onChange={e => setContact(e.target.value)} maxLength={120} autoComplete="email" autoCapitalize="none" />
      </label>
      <label className="landing-field">
        <span className="landing-field-row"><span>Message</span><small>{message.length}/1000</small></span>
        <textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={1000} rows={4} />
      </label>
      {err && <div className="landing-err" role="alert">{err}</div>}
      <div className="landing-row">
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
        <button type="button" className="secondary" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
