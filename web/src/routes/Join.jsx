import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { actions, sb, useParty } from '../lib/store.js';
import { fileToPortraitSource } from '../lib/image.js';
import Avatar from '../components/Avatar.jsx';
import PixelEmoji from '../components/PixelEmoji.jsx';
import Pixelating from '../components/Pixelating.jsx';
import Confetti from '../components/Confetti.jsx';
import ShareTicket from '../components/ShareTicket.jsx';
import { drawPortrait } from '../lib/pixelAvatar.js';
import { friendlyError } from '../lib/errors.js';
import { fixTicketName, joinNames, stillToJoin, ticketPeople } from '../lib/ticketNames.js';

// 8-bit characters: heroes, villains and monsters (3 rows of 6). Most guests use a selfie anyway.
const EMOJIS = [
  '👾','🧙','🥷','🤖','🧛','🧟',
  '👻','🐉','💀','🦖','👽','🧜',
  '🦸','🦹','🤠','🧚','🧞','👹',
];

export default function Join() {
  const { party, me, event } = useParty();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const invite = params.get('invite');
  const [inv, setInv] = useState(null); // { email, name, event_name, joined, players: [names already signed up on this ticket] }
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('👾');
  const [avatar, setAvatar] = useState(null);
  const [pin, setPin] = useState('');
  const [firstTimer, setFirstTimer] = useState(false);
  const [email, setEmail] = useState('');
  const [prefilled, setPrefilled] = useState(false); // email filled in from the ticket
  const [consent, setConsent] = useState(false);
  const [welcome, setWelcome] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [art, setArt] = useState(null); // the AI 8-bit portrait, once drawn
  const artJob = useRef(null);
  const [err, setErr] = useState('');
  const [addHere, setAddHere] = useState(false); // sign up another person on this phone
  // ?here=1 (from "Sign Cina up on this phone"): go straight to the "this phone will switch" warning.
  const [warnHere, setWarnHere] = useState(params.get('here') === '1'); // showing the "this phone will switch" warning first
  const [prevName, setPrevName] = useState(''); // who was signed in before adding someone on this phone
  const [who, setWho] = useState(''); // couples' tickets: which person this is ("Cina Boitnott")
  const [fixName, setFixName] = useState(''); // their name, if they fixed the spelling
  const [fixing, setFixing] = useState(false);
  const fileRef = useRef(null);
  const nav = useNavigate();
  const isPhone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px), (pointer: coarse)').matches;

  // Invite link: greet them and pre-fill their email (they still tick consent themselves).
  useEffect(() => {
    if (!invite) return;
    sb.rpc('invite_info', { p_invite: invite }).then(({ data }) => {
      if (!data) return;
      setInv(data);
      // The ticket's email belongs to whoever is first on it; a second person enters their own.
      if (!data.players?.length && data.email) { setEmail(e => e || data.email); setPrefilled(true); }
      // A couple's ticket with just one person left to sign up: that's who this is.
      const open = Array.isArray(data.taken) ? stillToJoin(data.name, data.taken) : ticketPeople(data.name);
      if (ticketPeople(data.name).length > 1 && open.length === 1) setWho(open[0].full);
    });
  }, [invite]);

  // Start drawing the 8-bit portrait as soon as the selfie is taken.
  function pixelate(photo) {
    setArt(null); setDrawing(true);
    const job = drawPortrait(photo)
      .then(a => { if (artJob.current === job) setArt(a); return a; })
      .catch(() => null)
      .finally(() => { if (artJob.current === job) setDrawing(false); });
    artJob.current = job;
  }

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const photo = await fileToPortraitSource(file);
      setAvatar(photo);
      pixelate(photo);
    } catch { setErr("That photo didn't work — try another."); }
  }

  async function submit(e) {
    e.preventDefault();
    if (askWho && !who) { setErr(`Tap which one you are: ${open.map(p => p.first).join(' or ')}.`); return; }
    if (!name.trim()) { setErr('Pick a nickname.'); return; }
    if (!/^\d{4}$/.test(pin)) { setErr('Pick a PIN: any 4 digits you\'ll remember.'); return; }
    // An email they typed needs the box ticked; one we filled in from the ticket is just skipped if unticked.
    if (email.trim() && !consent && !prefilled) { setErr('Tick the box under your email (or clear the email).'); return; }
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr("That email doesn't look right."); return; }
    setBusy(true); setErr('');
    try {
      // Join with the original selfie (kept for redraws), then swap in the 8-bit art when it's ready.
      const me = await actions.join({ name: name.trim(), pin, emoji, firstTimer, avatar });
      if (invite) await actions.claimInvite(invite, false).catch(() => {});
      if (invite && slot) {
        // Save which person they are, and fix the ticket's spelling if they corrected their name.
        const fixed = fixName.trim().replace(/\s+/g, ' ');
        const newTicket = fixed ? fixTicketName(inv?.name, slot, fixed) : null;
        if (couple || newTicket) await actions.setTicketWho(fixed || slot, newTicket);
      }
      if (email.trim() && consent) await actions.setMyEmail(email.trim(), true).catch(() => {});
      // A partner on someone's ticket: their email also goes on their guest row (for party updates).
      if (invite && email.trim() && consent) await actions.setTicketEmail(email.trim());
      // No ticket link, but their email is on the guest list: link them to it.
      if (!invite && email.trim() && consent) await actions.linkByEmail(email.trim());
      setWelcome(art ? { ...me, avatar: art } : me);
      if (avatar && artJob.current) {
        artJob.current.then(async a => {
          if (!a) return;
          await actions.setMyAvatar(a).catch(() => {});
          setWelcome(w => ({ ...w, avatar: a }));
        });
      }
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  // Couples' tickets ("Chris and Cina Boitnott"): who's on it, and who hasn't signed up yet.
  const people = ticketPeople(inv?.name);
  const couple = people.length > 1;
  const open = !inv ? [] : Array.isArray(inv.taken) ? stillToJoin(inv.name, inv.taken) : people;
  const askWho = couple && open.length > 0;
  const firstsOf = list => joinNames(list.map(p => p.first));
  // The ticket name this person is (a couple's pick, or a one-person ticket's name): they can fix its spelling.
  const slot = couple ? who : people.length === 1 ? people[0].full : '';
  const pick = full => { setWho(full); setFixName(''); setFixing(false); setErr(''); };
  const nameFix = slot && !(inv?.players?.length && !couple) && (fixing ? (
    <label className="field who-fix">
      <span>Your name, spelled right</span>
      <input value={fixName} onChange={e => setFixName(e.target.value)} maxLength={60} autoComplete="name" autoCapitalize="words" />
    </label>
  ) : (
    <div className="who-note">
      You're <strong>{fixName.trim() || slot}</strong>.{' '}
      <button type="button" className="link" onClick={() => { setFixName(fixName || slot); setFixing(true); }}>Spelled wrong? Fix it</button>
    </div>
  ));

  if (welcome) {
    // Who on the ticket still needs to sign up after this person.
    const nextUp = couple ? open.filter(p => p.full !== who) : [];
    const them = nextUp.length === 1 ? nextUp[0].first : 'them';
    return (
      <div className="screen reveal" style={{ background: welcome.color }}>
        {!drawing && <Confetti count={120} />}
        <div className="reveal-card reveal-pop">
          <div className="reveal-avatar">
            {drawing
              ? <Pixelating size={132} src={avatar} />
              : <Avatar avatar={welcome.avatar} emoji={welcome.emoji} name={welcome.display_name} color={welcome.color} size={132} />}
          </div>
          <div className="reveal-label">You're in,</div>
          <div className="reveal-team">{welcome.display_name}</div>
          <p className="welcome-pin">
            Your PIN is <strong>{pin}</strong> — {isPhone ? 'save it in case you switch phones. Screenshot this!' : 'use it to sign in on your phone at the party!'}
          </p>
          {prevName && (
            <div className="note-warn">
              Signed in as <strong>{welcome.display_name}</strong> now.<br />
              {prevName}: to switch back, go to ME → Sign out / switch player → Sign in as someone else, and type your PIN.
            </div>
          )}
          <button className="cta" onClick={() => nav(next, { replace: true })}>Press start</button>
          {invite && !prevName && (nextUp.length ? (
            <div className="bring-box">
              <div className="bring-title">Now get {firstsOf(nextUp)} in</div>
              <p>Send {them} this link so they can sign up too.</p>
              <ShareTicket invite={invite} label={`Send ${them} the link`} />
              <p className="bring-here">
                <a className="link" href={`/join?invite=${encodeURIComponent(invite)}&here=1`}>{nextUp.length === 1 ? `${them}'s` : "They're"} right here? Sign {them} up now</a>
              </p>
            </div>
          ) : (
            <div className="bring-box">
              <div className="bring-title">Bringing someone?</div>
              <p>Send them this link so they can sign up too.</p>
              <ShareTicket invite={invite} label="Send my ticket link" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const closed = party?.status === 'closed';
  // Is the signed-in player already on this ticket? Match by player id (nickname on older servers).
  const onTicket = !!(inv && me && (inv.player_ids ? inv.player_ids.includes(me.id) : inv.players?.includes(me.display_name)));
  // Joining a ticket someone already used: they're a partner, so the ticket's email isn't theirs.
  const partner = !!inv?.players?.length;

  // Someone already on this ticket opened the link again (e.g. to add their partner):
  // point them to sharing the link, instead of making a new player on their own phone.
  if (invite && onTicket && !addHere) {
    const left = couple ? open : []; // named people on the ticket who still need to sign up
    const them = left.length === 1 ? left[0].first : 'them';
    return (
      <div className="screen form">
        <h1>{left.length ? `Get ${firstsOf(left)} in` : 'Add someone to your ticket'}</h1>
        <div className="invite-hi">
          You're already signed up on this ticket as <strong>{me.display_name}</strong>.
          {inv.players.length > 1 && <> Also on it: {inv.players.filter(n => n !== me.display_name).join(', ')}.</>}
        </div>
        <p>{left.length
          ? <>Send {them} this link so they can pick their own nickname.</>
          : <>To add someone (like your partner), send them this link so they can pick their own nickname.</>}</p>
        <ShareTicket invite={invite} big label={left.length ? `Send ${them} the link` : undefined} />
        <Link to="/" className="cta" style={{ marginTop: 18, display: 'block', textAlign: 'center' }}>Back to the game</Link>
        {!warnHere ? (
          <button type="button" className="link" style={{ marginTop: 14 }} onClick={() => setWarnHere(true)}>
            {left.length ? `${left.length === 1 ? `${them}'s` : "They're"} right here? Sign ${them} up here instead` : 'Or sign them up right here instead'}
          </button>
        ) : (
          <div className="note-warn" role="alert" style={{ marginTop: 18 }}>
            <div className="note-warn-title">Heads up: this switches who's signed in here</div>
            <p>
              After you sign them up, you'll be signed in here as <strong>the new player</strong> (<strong>{me.display_name}</strong>'s scores stay saved).
            </p>
            <p>
              To switch back to {me.display_name}: ME → Sign out / switch player → Sign in as someone else,
              pick {me.display_name} and type <strong>your PIN</strong>.
            </p>
            <button type="button" className="ghost-btn" onClick={() => { setPrevName(me.display_name); setAddHere(true); }}>
              OK, sign them up here
            </button>
            <button type="button" className="link" style={{ marginTop: 12 }} onClick={() => setWarnHere(false)}>Cancel</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <form className="screen form" onSubmit={submit}>
      <h1>Join the party</h1>
      {inv && (askWho ? (
        <div className="invite-hi">
          Hi {firstsOf(people)}! You're in for {inv.event_name}.
          <div className="who-label">Which one are you?</div>
          <div className="who-pick">
            {people.map(p => {
              const done = !open.some(o => o.full === p.full);
              return (
                <button type="button" key={p.full} disabled={done} aria-pressed={who === p.full}
                  className={`who-btn${who === p.full ? ' on' : ''}${done ? ' done' : ''}`} onClick={() => pick(p.full)}>
                  {p.first}{done ? ' ✓' : ''}
                </button>
              );
            })}
          </div>
          {open.length < people.length && (() => {
            const inAlready = people.filter(p => !open.some(o => o.full === p.full));
            return <div className="who-note">{firstsOf(inAlready)} {inAlready.length === 1 ? 'is' : 'are'} already in. You're next!</div>;
          })()}
          {nameFix}
        </div>
      ) : inv.players?.length ? (
        <div className="invite-hi">
          Already signed up on this ticket: <strong>{inv.players.join(', ')}</strong>.<br />
          Coming with them? Fill this in and you're on their ticket too.
        </div>
      ) : <div className="invite-hi">Hi {firstsOf(people) || 'there'}! You're in for {inv.event_name}.{nameFix}</div>)}
      {event && !inv && <div className="event-chip">{event.name}{event.starts_on ? ` · ${new Date(`${event.starts_on}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}</div>}
      <Link to={rejoinHref(next, invite)} className="rejoin-banner">
        Joined before (or played a past event)? <strong>Get back in →</strong>
      </Link>

      {me && !welcome && addHere && (
        <div className="note-warn">
          Signing up someone new. Afterwards you'll be signed in as them.{' '}
          <strong>{me.display_name}</strong>: switch back later with your PIN.{' '}
          <button type="button" className="link" onClick={() => { setAddHere(false); setWarnHere(false); setPrevName(''); }}>Never mind</button>
        </div>
      )}

      {me && !welcome && !addHere && (
        <div className="note-ok">
          Signed in as <strong>{me.display_name}</strong>. This makes a new player.{' '}
          <Link to="/" className="link">Go back</Link>
          {invite && (
            <div style={{ marginTop: 10 }}>
              <button type="button" className="ghost-btn small" onClick={async () => {
                try { await actions.claimInvite(invite, false); nav('/', { replace: true }); } catch (e) { setErr(friendlyError(e)); }
              }}>That's me: use {me.display_name}</button>
            </div>
          )}
        </div>
      )}

      {closed && <div className="err">Scoring's closed. No new players.</div>}

      <div className="reg-photo">
        <button type="button" className="reg-photo-btn" onClick={() => fileRef.current?.click()}>
          {!avatar ? <span className="reg-photo-emoji"><PixelEmoji e={emoji} size={48} grid={16} /></span>
            : drawing ? <Pixelating size={80} label={false} src={avatar} />
            : <img src={art || avatar} alt="you" className="reg-photo-img"
                style={{ imageRendering: art ? 'pixelated' : 'auto' }} />}
          {!drawing && <span className="reg-photo-badge">{avatar ? '↺' : <PixelEmoji e="📷" size={20} />}</span>}
        </button>
        <div className="reg-photo-text">
          <div className="reg-photo-title">{!avatar ? 'Add a selfie' : drawing ? 'Pixelating…' : art ? 'Looking good' : 'Photo saved'}</div>
          <div className="muted small">
            {!avatar ? 'Optional'
              : drawing ? 'Making your 8-bit self'
              : art ? <button type="button" className="linkbtn" onClick={() => { setAvatar(null); setArt(null); artJob.current = null; }}>remove photo</button>
              : <button type="button" className="linkbtn" onClick={() => pixelate(avatar)}>Couldn't pixelate. Try again</button>}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="user" onChange={onPhoto} hidden />
      </div>

      <label className="field">
        <span>Nickname (on the TV, up to 12 letters)</span>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={12}
          placeholder="e.g. Flipper Fran"
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="next"
        />
      </label>

      <label className="field">
        <span>PIN: pick 4 digits you'll remember</span>
        <span className="field-help">{isPhone ? 'Save it in case you switch phones.' : 'Use it to sign in on your phone at the party.'}</span>
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
        <span>{avatar ? 'Emoji (if no photo)' : 'Emoji'}</span>
        <div className="emoji-grid">
          {EMOJIS.map(e => (
            <button key={e} type="button" className={`emoji-btn${emoji === e ? ' on' : ''}`} onClick={() => setEmoji(e)} aria-label={e}><PixelEmoji e={e} size={30} grid={14} /></button>
          ))}
        </div>
      </label>

      <label className="field row">
        <input type="checkbox" checked={firstTimer} onChange={e => setFirstTimer(e.target.checked)} />
        <span>New to pinball?</span>
      </label>

      <label className="field">
        <span>{partner ? 'Your email (optional)' : 'Email results to me (optional)'}</span>
        {partner && <span className="field-help">Your own, for party updates and your results.</span>}
        <input type="email" value={email} onChange={e => { setEmail(e.target.value); setPrefilled(false); }}
          placeholder="you@example.com" autoComplete="email" inputMode="email" autoCapitalize="none" />
        {prefilled && email && (
          <span className="field-help">
            From your ticket. Not yours?{' '}
            <button type="button" className="link" onClick={() => { setEmail(''); setConsent(false); setPrefilled(false); }}>Clear it</button>
          </span>
        )}
      </label>
      {email.trim() && (
        <label className="field row consent">
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
          <span>{partner ? 'Yes, email me party updates and my results. Never marketing.' : 'Yes, email me my results. Never used for marketing.'}</span>
        </label>
      )}

      {err && <div className="err" role="alert">{err}</div>}
      <div className="actionbar">
        <button className="cta" disabled={busy || closed} type="submit">
          {busy ? 'Joining…' : 'Insert coin · Join'}
        </button>
      </div>
    </form>
  );
}

// "Joined before?" keeps where they were headed and the invite link.
function rejoinHref(next, invite) {
  const q = new URLSearchParams();
  if (next && next !== '/') q.set('next', next);
  if (invite) q.set('invite', invite);
  const qs = q.toString();
  return `/rejoin${qs ? `?${qs}` : ''}`;
}
