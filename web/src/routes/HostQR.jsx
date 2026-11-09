import { useParty } from '../lib/store.js';
import QR from '../components/QR.jsx';

// Print page: open, Cmd-P, tape one QR to each machine.
export default function HostQR() {
  const { machines } = useParty();
  const origin = location.origin;
  const host = location.host;
  return (
    <div className="qr-sheet">
      <div className="qr-sheet-join">
        <div>
          <div className="qr-sheet-big">The Ultimate Woodside Pinball Tournament</div>
          <div className="qr-sheet-sub">Scan to join, log scores, and see where you stand.</div>
          <div className="qr-sheet-url">{host}</div>
        </div>
        <QR value={`${origin}/`} size={220} />
      </div>
      <div className="qr-grid">
        {machines.map(m => (
          <div key={m.id} className="qr-card">
            <div className="qr-card-title">{m.name}</div>
            <div className="qr-card-meta">Scan to log your {m.name} score</div>
            <QR value={`${origin}/machine/${m.id}`} size={200} />
            <div className="qr-card-url">{host}/machine/{m.id}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
