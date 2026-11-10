import { useEffect, useReducer, useState } from 'react';
import { Outlet, useNavigate, useLocation, Link, NavLink } from 'react-router-dom';
import { getHostPass, getToken, useParty } from './lib/store.js';
import { captureFakeFlag } from './lib/scoreReader.js';
import { captureAccessKey, checkAccess, getAccess, isAuthorized, isOpenToVisitors, rememberDevice, setAccess, takePendingKey } from './lib/access.js';
import Landing from './routes/Landing.jsx';
import Avatar from './components/Avatar.jsx';
import PixelEmoji from './components/PixelEmoji.jsx';
import PinballIcon from './components/PinballIcon.jsx';

captureFakeFlag(); // read ?fakephoto=… before the join redirect drops the query string
captureAccessKey(); // party QR codes carry ?k=<key>: remember it and take it off the address bar

// Pages anyone can see without joining.
function isPublicPath(p) {
  return p === '/join' || p === '/rejoin' || p === '/host' || p === '/host/test' || p === '/host/guests' || p === '/host/calibrate' || p === '/about' || /^\/machine\/\d+\/guide$/.test(p);
}

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

export default function App() {
  const { me, meChecked, error, ready } = useParty();
  const nav = useNavigate();
  const loc = useLocation();
  const online = useOnline();
  const [, bumpAccess] = useReducer(n => n + 1, 0);
  const [accessNote, setAccessNote] = useState('');
  const authorized = !!me || isAuthorized();
  const gated = meChecked && !authorized && !isOpenToVisitors(loc.pathname, loc.search);

  // A party QR key from the address bar: check it once. A bad or old one is dropped (landing page).
  useEffect(() => {
    const k = takePendingKey();
    if (!k) return;
    checkAccess(k).then(r => {
      if (r.ok) return;
      if (getAccess() === k) setAccess(null);
      setAccessNote(r.error || 'That QR code is out of date. Ask a host for the party password.');
      bumpAccess();
    }).catch(() => {});
  }, []);

  // Once a phone has joined, it stays let in (even after signing out to add someone).
  useEffect(() => { if (me) rememberDevice(getToken()); }, [me]);

  useEffect(() => {
    if (!meChecked || gated) return;
    if (!me && !isPublicPath(loc.pathname)) {
      // Remember where they were headed (e.g. a machine QR) and come back after joining.
      const dest = loc.pathname + (loc.search || '');
      nav(`/join?next=${encodeURIComponent(dest)}`, { replace: true });
    }
  }, [meChecked, me, gated, loc.pathname, loc.search, nav]);

  // New screen → start at the top (steps within a machine flow keep their own scroll).
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname, loc.state?.step]);

  if (!meChecked || (!ready && !error)) {
    return (
      <div className="boot">
        <div className="boot-logo"><PinballIcon size={64} /></div>
        <div className="boot-name">The Ultimate<br />Woodside Pinball<br />Tournament</div>
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  if (gated) return <Landing onIn={() => { setAccessNote(''); bumpAccess(); }} notice={accessNote} />;

  // Bottom tabs on the main screens only (not mid-score, not while joining).
  const showTabs = !!me && (loc.pathname === '/' || loc.pathname === '/ranks' || loc.pathname === '/me');

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="The Ultimate Woodside Pinball Tournament home">
          <span className="brand-mark"><PinballIcon size={24} /></span>
          <span className="brand-word">Woodside Pinball</span>
        </Link>
        <div className="topbar-right">
          {me && (
            <nav className="topnav" aria-label="Main">
              <NavLink to="/" end className="topbar-link">Play</NavLink>
              <NavLink to="/ranks" className="topbar-link">Ranks</NavLink>
            </nav>
          )}
          {getHostPass() ? <NavLink to="/host" className="topbar-link host-chip">Host</NavLink> : <NavLink to="/about" className="topbar-link">How to play</NavLink>}
          {me ? (
            <NavLink to="/me" className={`me${showTabs ? ' on-tab-screen' : ''}`} style={{ borderColor: me.color }} aria-label="My progress">
              <Avatar avatar={me.avatar} emoji={me.emoji} name={me.display_name} color={me.color} size={28} />
              <span className="name">{me.display_name}</span>
            </NavLink>
          ) : loc.pathname !== '/join' ? (
            <NavLink to="/join" className="topbar-link primary-link">Join</NavLink>
          ) : null}
        </div>
      </header>
      {!online ? (
        <div className="offline" role="status">📡 Offline. Scores can't send till Wi-Fi's back.</div>
      ) : error && !ready ? (
        <div className="offline" role="status">Can't reach scoreboard. Retrying…</div>
      ) : null}
      <main className={`main${showTabs ? ' with-tabs' : ''}`}>
        <Outlet />
      </main>
      {showTabs && (
        <nav className="tabbar" aria-label="Main">
          <NavLink to="/" end className="tab"><PixelEmoji e="🕹️" size={24} grid={14} /><span>Play</span></NavLink>
          <NavLink to="/ranks" className="tab"><PixelEmoji e="🏆" size={24} grid={14} /><span>Ranks</span></NavLink>
          <NavLink to="/me" className="tab">
            <Avatar avatar={me.avatar} emoji={me.emoji} name={me.display_name} color={me.color} size={24} />
            <span>Me</span>
          </NavLink>
        </nav>
      )}
    </div>
  );
}
