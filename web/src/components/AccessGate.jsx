import { useEffect, useReducer } from 'react';
import { Link } from 'react-router-dom';
import Landing from '../routes/Landing.jsx';
import { ensureJoinKey, isAuthorized } from '../lib/access.js';
import { getHostPass } from '../lib/store.js';

// Pages outside the guest app (/tv, /lights-sim): shown only to browsers that are in (a player, the
// party code, or a host unlock here once, which is how the TV Mac is set up). Everyone else gets the
// landing page. host: the page needs the host passcode (the QR sheet prints the party key).
export default function AccessGate({ host = false, children }) {
  const [, bump] = useReducer(n => n + 1, 0);
  useEffect(() => { ensureJoinKey().then(() => bump()); }, []);
  if (host && !getHostPass()) {
    return (
      <div className="landing">
        <div className="landing-card" style={{ marginTop: 32 }}>
          <h2>Hosts only</h2>
          <p className="landing-help">Unlock the host page on this device first, then come back here.</p>
          <Link className="primary landing-btn" to="/host">Open the host page</Link>
        </div>
      </div>
    );
  }
  if (!host && !isAuthorized()) return <Landing onIn={bump} />;
  return children;
}
