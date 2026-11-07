import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { actions, useParty } from '../lib/store.js';
import Avatar from '../components/Avatar.jsx';

export default function Rejoin() {
  const { players, ready } = useParty();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const nav = useNavigate();

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...players]
      .filter(p => !needle || p.display_name.toLowerCase().includes(needle))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [players, q]);

  async function submit(e) {
    e.preventDefault();
    if (!/^\d{4}$/.test(pin)) { setErr('Enter your 4-digit PIN.'); return; }
    setBusy(true); setErr('');
    try {
      await actions.rejoin(picked.id, pin);
      nav(next, { replace: true });
    } catch (e) { setErr(e.message); setPin(''); }
    finally { setBusy(false); }
  }

  if (picked) {
    return (
      <form className="screen form" onSubmit={submit}>
        <button type="button" className="back linkbtn" onClick={() => { setPicked(null); setErr(''); setPin(''); }}>← not me</button>
        <div className="rejoin-who">
          <Avatar avatar={picked.avatar} emoji={picked.emoji} name={picked.display_name} color={picked.color} size={72} ring />
          <h1>Hi, {picked.display_name}</h1>
        </div>
        <label className="field">
          <span>Your 4-digit PIN</span>
          <input
            className="pin-input"
            autoFocus
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            placeholder="••••"
          />
        </label>
        {err && <div className="err">{err}</div>}
        <button className="primary big" disabled={busy || pin.length !== 4} type="submit">{busy ? 'Checking…' : 'Get back in'}</button>
        <p className="muted small">Forgot it? Find the host. They can reset your PIN.</p>
      </form>
    );
  }

  return (
    <div className="screen form">
      <h1>Get back in</h1>
      <p className="muted">Tap your name, then enter your PIN.</p>
      <label className="field">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search names" autoComplete="off" />
      </label>
      <div className="pick-list">
        {!ready && <div className="muted">Loading…</div>}
        {ready && list.length === 0 && <div className="muted">No one by that name yet.</div>}
        {list.map(p => (
          <button key={p.id} className="pick-row" onClick={() => setPicked(p)}>
            <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={34} />
            <span>{p.display_name}</span>
          </button>
        ))}
      </div>
      <Link to="/join" className="muted small center-text">New here? <span className="link">Join instead</span></Link>
    </div>
  );
}
