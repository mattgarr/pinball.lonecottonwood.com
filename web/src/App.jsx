import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useParty } from './lib/store.js';
import Avatar from './components/Avatar.jsx';

// Pages anyone can see without joining.
function isPublicPath(p) {
  return p === '/join' || p === '/rejoin' || p === '/host' || p === '/about' || /^\/machine\/\d+\/guide$/.test(p);
}

export default function App() {
  const { me, meChecked, error, ready } = useParty();
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    if (!meChecked) return;
    if (!me && !isPublicPath(loc.pathname)) {
      // Remember where they were headed (e.g. a machine QR) and come back after joining.
      nav(`/join?next=${encodeURIComponent(loc.pathname)}`, { replace: true });
    }
  }, [meChecked, me, loc.pathname, nav]);

  if (!meChecked || (!ready && !error)) return <div className="screen center"><div className="muted">Loading…</div></div>;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => nav('/')}>
          <span className="brand-full">🎯 Pinball Wizard</span>
          <span className="brand-short">🎯 PW</span>
        </button>
        <div className="topbar-right">
          <Link to="/about" className="topbar-link">How to play</Link>
          {me ? (
            <Link to="/me" className="me" style={{ borderColor: me.color }}>
              <Avatar avatar={me.avatar} emoji={me.emoji} name={me.display_name} color={me.color} size={26} />
              <span className="name">{me.display_name}</span>
            </Link>
          ) : (
            <Link to="/join" className="topbar-link primary-link">Join</Link>
          )}
        </div>
      </header>
      {error && !ready && <div className="offline">Can't reach the scoreboard. Check your connection; it'll retry.</div>}
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
