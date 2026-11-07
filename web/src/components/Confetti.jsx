import { useMemo } from 'react';

const COLORS = ['#ffcc00', '#ff3ea5', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#06b6d4', '#ef4444'];

// Dependency-free CSS confetti burst. Fills its nearest positioned ancestor.
export default function Confetti({ count = 90, seed = 0 }) {
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => {
    const r = (n) => ((Math.sin((seed + 1) * 999 + i * (n + 7)) + 1) / 2);
    return {
      left: r(1) * 100,
      delay: r(2) * 0.8,
      dur: 2.2 + r(3) * 2.4,
      color: COLORS[Math.floor(r(4) * COLORS.length) % COLORS.length],
      size: 6 + r(5) * 9,
      drift: (r(6) * 2 - 1) * 120,
      spin: 360 + Math.round(r(7) * 720),
    };
  }), [count, seed]);

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: p.left + '%',
            background: p.color,
            width: p.size + 'px',
            height: p.size * 0.6 + 'px',
            animationDelay: p.delay + 's',
            animationDuration: p.dur + 's',
            '--drift': p.drift + 'px',
            '--spin': p.spin + 'deg',
          }}
        />
      ))}
    </div>
  );
}
