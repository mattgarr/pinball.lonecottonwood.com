import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { getHostPass, useParty } from './lib/store.js';
import { captureFakeFlag } from './lib/scoreReader.js';
import Avatar from './components/Avatar.jsx';
import PixelEmoji from './components/PixelEmoji.jsx';

captureFakeFlag(); // read ?fakephoto=… before the join redirect drops the query string

// Pages anyone can see without joining.
function isPublicPath(p) {
  return p === '/join' || p === '/rejoin' || p === '/host' || p === '/host/test' || p === '/about' || /^\/machine\/\d+\/guide$/.test(p);
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

  useEffect(() => {
    if (!meChecked) return;
    if (!me && !isPublicPath(loc.pathname)) {
      // Remember where they were headed (e.g. a machine QR) and come back after joining.
      nav(`/join?next=${encodeURIComponent(loc.pathname)}`, { replace: true });
    }
  }, [meChecked, me, loc.pathname, nav]);

  // New screen → start at the top (steps within a machine flow keep their own scroll).
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname, loc.state?.step]);

  if (!meChecked || (!ready && !error)) {
    return (
      <div className="boot">
        <div className="boot-logo"><PixelEmoji e="🎯" size={64} /></div>
        <div className="boot-name">Pinball Wizard</div>
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Pinball Wizard home">
          <span className="brand-mark"><PixelEmoji e="🎯" size={24} /></span>
          <span className="brand-word">Pinball Wizard</span>
        </Link>
        <div className="topbar-right">
          {getHostPass() ? <Link to="/host" className="topbar-link host-chip">Host</Link> : <Link to="/about" className="topbar-link">How to play</Link>}
          {me ? (
            <Link to="/me" className="me" style={{ borderColor: me.color }} aria-label="My progress">
              <Avatar avatar={me.avatar} emoji={me.emoji} name={me.display_name} color={me.color} size={28} />
              <span className="name">{me.display_name}</span>
            </Link>
          ) : (
            <Link to="/join" className="topbar-link primary-link">Join</Link>
          )}
        </div>
      </header>
      {!online ? (
        <div className="offline" role="status">📡 Offline. Scores can't send till Wi-Fi's back.</div>
      ) : error && !ready ? (
        <div className="offline" role="status">Can't reach scoreboard. Retrying…</div>
      ) : null}
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
