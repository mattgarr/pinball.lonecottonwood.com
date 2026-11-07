import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { actions, useParty } from '../lib/store.js';
import { fileToAvatarDataUrl } from '../lib/image.js';
import Avatar from '../components/Avatar.jsx';
import PixelEmoji from '../components/PixelEmoji.jsx';
import Confetti from '../components/Confetti.jsx';

const EMOJIS = [
  '🎯','🕹️','🎰','🪩',
  '💎','👑','🏆','🔔',
  '⚡','🌪️','🔥','✨',
  '🧙','🐉','💀','🤖',
];

export default function Join() {
  const { party, me } = useParty();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🎯');
  const [avatar, setAvatar] = useState(null);
  const [pin, setPin] = useState('');
  const [firstTimer, setFirstTimer] = useState(false);
  const [welcome, setWelcome] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const nav = useNavigate();

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setAvatar(await fileToAvatarDataUrl(file, 192)); }
    catch { setErr("Couldn't read that photo. Try again."); }
    e.target.value = '';
  }

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) { setErr('Pick a nickname.'); return; }
    if (!/^\d{4}$/.test(pin)) { setErr('Pick a 4-digit PIN.'); return; }
    setBusy(true); setErr('');
    try {
      const me = await actions.join({ name: name.trim(), pin, emoji, firstTimer, avatar });
      setWelcome(me);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (welcome) {
    return (
      <div className="screen reveal" style={{ background: welcome.color }}>
        <Confetti count={120} />
        <div className="reveal-card reveal-pop">
          <div className="reveal-avatar">
            <Avatar avatar={welcome.avatar} emoji={welcome.emoji} name={welcome.display_name} color={welcome.color} size={132} />
          </div>
          <div className="reveal-label">You're in,</div>
          <div className="reveal-team">{welcome.display_name}</div>
          <p className="welcome-pin">Your PIN <strong>{pin}</strong> gets you back in on any phone. Screenshot this if you'll forget it!</p>
          <button className="cta" onClick={() => nav(next, { replace: true })}>Press start</button>
        </div>
      </div>
    );
  }

  const closed = party?.status === 'closed';

  return (
    <form className="screen form" onSubmit={submit}>
      <h1>Join the party</h1>
      <Link to={`/rejoin${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="rejoin-banner">
        Already joined on another phone? <strong>Get back in →</strong>
      </Link>

      {me && !welcome && (
        <div className="note-ok">
          This phone is signed in as <strong>{me.display_name}</strong>. Joining makes a new player.{' '}
          <Link to="/" className="link">Back to machines</Link>
        </div>
      )}

      {closed && <div className="err">Scoring is closed for the night, so new players can't join.</div>}

      <div className="reg-photo">
        <button type="button" className="reg-photo-btn" onClick={() => fileRef.current?.click()}>
          {avatar
            ? <img className="reg-photo-img" src={avatar} alt="your photo" />
            : <span className="reg-photo-emoji"><PixelEmoji e={emoji} size={48} grid={16} /></span>}
          <span className="reg-photo-badge">{avatar ? '↺' : <PixelEmoji e="📷" size={20} />}</span>
        </button>
        <div className="reg-photo-text">
          <div className="reg-photo-title">{avatar ? 'Looking good' : 'Add a selfie'}</div>
          <div className="muted small">
            {avatar
              ? <button type="button" className="linkbtn" onClick={() => setAvatar(null)}>remove photo</button>
              : 'Optional. Or pick an emoji below.'}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="user" onChange={onPhoto} hidden />
      </div>

      <label className="field">
        <span>Nickname (shows on the TV)</span>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={24}
          placeholder="e.g. Quarter Slayer"
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="next"
        />
      </label>

      <label className="field">
        <span>Pick a 4-digit PIN, so you can get back in later</span>
        <input
          className="pin-input"
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder="••••"
        />
      </label>

      <label className="field">
        <span>{avatar ? 'Backup emoji' : 'Emoji'}</span>
        <div className="emoji-grid">
          {EMOJIS.map(e => (
            <button key={e} type="button" className={`emoji-btn${emoji === e ? ' on' : ''}`} onClick={() => setEmoji(e)} aria-label={e}><PixelEmoji e={e} size={30} grid={14} /></button>
          ))}
        </div>
      </label>

      <label className="field row">
        <input type="checkbox" checked={firstTimer} onChange={e => setFirstTimer(e.target.checked)} />
        <span>First time playing pinball? (There's a prize for that.)</span>
      </label>

      {err && <div className="err" role="alert">{err}</div>}
      <div className="actionbar">
        <button className="cta" disabled={busy || closed} type="submit">
          {busy ? 'Joining…' : 'Insert coin · Join'}
        </button>
      </div>
    </form>
  );
}
