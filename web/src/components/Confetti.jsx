import { useMemo } from 'react';

// 8-bit confetti: NES palette, square pixel blocks, choppy fall and quarter-turn spins (see .confetti-piece CSS).
const COLORS = ['#f8b800', '#e40058', '#58d854', '#3cbcfc', '#f878f8', '#fc7460', '#fcfcfc', '#b8f818'];

// Dependency-free CSS confetti burst. Fills its nearest positioned ancestor.
export default function Confetti({ count = 90, seed = 0 }) {
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => {
    const r = (n) => ((Math.sin((seed + 1) * 999 + i * (n + 7)) + 1) / 2);
    return {
      left: r(1) * 100,
      delay: r(2) * 0.8,
      dur: 2.2 + r(3) * 2.4,
      color: COLORS[Math.floor(r(4) * COLORS.length) % COLORS.length],
      size: [6, 8, 12][Math.floor(r(5) * 3) % 3], // whole pixel blocks
      drift: (r(6) * 2 - 1) * 120,
      spin: 90 * (2 + Math.floor(r(7) * 6)), // quarter turns only
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
            height: (p.size === 12 ? 6 : p.size) + 'px', // squares, plus some 2x1 bricks
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
