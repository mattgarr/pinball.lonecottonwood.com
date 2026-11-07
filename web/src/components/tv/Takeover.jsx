import { useEffect, useState } from 'react';
import Avatar from '../Avatar.jsx';
import Confetti from '../Confetti.jsx';
import Backbox from './Backbox.jsx';
import Dmd from './Dmd.jsx';
import { fmt } from '../../lib/scoring.js';
import { artFallback, machineArt, machineGlow } from './theme.js';

export const TAKEOVER_MS = 6500;

// Count from `from` to `to` after `delay` ms, ease-out.
export function useRamp(from, to, ms = 2200, delay = 600) {
  const [v, setV] = useState(from);
  useEffect(() => {
    let raf, t0;
    const tick = now => {
      t0 ??= now;
      const t = Math.min(1, (now - t0) / ms);
      setV(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    const to_ = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => { clearTimeout(to_); cancelAnimationFrame(raf); };
  }, [from, to, ms, delay]);
  return v;
}

// Full-canvas "NEW HIGH SCORE" celebration. Mount with key={item.id}; calls onDone when finished.
export default function Takeover({ item, onDone, queued = 0 }) {
  const [leaving, setLeaving] = useState(false);
  const shown = useRamp(item.prevScore, item.score, 2300, 700);
  const p = item.player, m = item.machine;

  useEffect(() => {
    const a = setTimeout(() => setLeaving(true), TAKEOVER_MS - 550);
    const b = setTimeout(onDone, TAKEOVER_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [onDone]);

  const sub = item.prevPlayer
    ? <>dethroned <b>{item.prevPlayer.display_name}</b> · {fmt(item.prevScore)}</>
    : item.selfBeat
      ? <>beat their own record of {fmt(item.prevScore)}</>
      : <>first score on the board</>;

  return (
    <div className={`to${leaving ? ' out' : ''}`} style={{ '--glow': machineGlow(m.name) }}>
      <img className="to-bg" src={machineArt(m.name)} alt="" onError={e => artFallback(e, m.name)} />
      <div className="to-shade" />
      <div className="to-rays" />
      <Confetti count={140} seed={item.score % 997} />

      <div className="to-marquee">
        <span className="to-bulbs" />
        <span className="to-title">NEW HIGH SCORE</span>
        <span className="to-bulbs r" />
      </div>

      <div className="to-body">
        <Backbox machine={m} className="to-bb" />
        <div className="to-info">
          <div className="to-machine">{m.name}<span>{m.manufacturer} · {m.year}</span></div>
          <div className="to-player">
            <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={132} ring />
            <div className="to-pname">{p.display_name}</div>
          </div>
          <Dmd ghost tone="hot" className="to-score" reserve={fmt(item.score)}>{fmt(shown)}</Dmd>
          <div className="to-sub">{sub}</div>
        </div>
      </div>
      {queued > 0 && <div className="to-queued">+{queued} more new record{queued > 1 ? 's' : ''}</div>}
      <div className="to-timer" style={{ animationDuration: `${TAKEOVER_MS}ms` }} />
    </div>
  );
}
