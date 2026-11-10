import { useEffect, useState } from 'react';
import { useParty } from '../lib/store.js';
import { hostAccess, partyUrl } from '../lib/access.js';
import QR from '../components/QR.jsx';

// Print page: open, Cmd-P, tape one QR to each machine. Every code carries the party key (?k=…), so
// scanning one lets a phone join; the plain address only shows the landing page.
// ?nopass hides the password line (e.g. for a sheet posted where strangers could see it).
export default function HostQR() {
  const { machines } = useParty();
  const [access, setAccess] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { hostAccess.get().then(setAccess).catch(e => setErr(e.message)); }, []);
  const host = location.host;
  const showPass = !new URLSearchParams(location.search).has('nopass');
  if (!access) {
    return <div className="qr-sheet"><p className="qr-sheet-note">{err ? `Couldn't load the party key: ${err}` : 'Loading…'}</p></div>;
  }
  const key = access.key;
  return (
    <div className="qr-sheet">
      <div className="qr-sheet-join">
        <div>
          <div className="qr-sheet-big">The Ultimate Woodside Pinball Tournament</div>
          <div className="qr-sheet-sub">Scan to join, log scores, and see where you stand.</div>
          <div className="qr-sheet-url">{host}</div>
          {showPass && <div className="qr-sheet-sub">No camera? Go to {host} and type the party password: <b>{access.password}</b></div>}
        </div>
        <QR value={partyUrl('/', key)} size={220} />
      </div>
      <div className="qr-grid">
        {machines.map(m => (
          <div key={m.id} className="qr-card">
            <div className="qr-card-title">{m.name}</div>
            <div className="qr-card-meta">Scan to log your {m.name} score</div>
            <QR value={partyUrl(`/machine/${m.id}`, key)} size={200} />
            <div className="qr-card-url">{host}/machine/{m.id}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
