import { useEffect, useMemo, useState } from 'react';

const COLORS = ['#f8b800', '#e40058', '#3cbcfc', '#58d854', '#f878f8', '#fce0a8', '#0058f8'];
const GRID = 8;

// Shown while Gemini draws the 8-bit portrait (~7 s). With `src`, the real photo shows underneath
// while blocks flicker over it like a sprite being drawn,
// and a progress bar eases toward full (it never claims 100% until the art arrives).
export default function Pixelating({ size = 84, label = true, src = null }) {
  const cells = useMemo(() => Array.from({ length: GRID * GRID }, (_, i) => ({
    c: COLORS[(i * 7 + (i >> 3) * 3) % COLORS.length],
    d: ((i * 37) % 64) * 0.06,
  })), []);
  const [pct, setPct] = useState(4);
  useEffect(() => {
    const t0 = Date.now();
    const iv = setInterval(() => setPct(Math.min(96, Math.round(100 * (1 - Math.exp(-(Date.now() - t0) / 4000))))), 200);
    return () => clearInterval(iv);
  }, []);
  return (
    <span className="pxing" style={{ width: size }} role="status" aria-label="Pixelating your selfie">
      <span className={`pxing-box${src ? ' has-photo' : ''}`} style={{ width: size, height: size, gridTemplateColumns: `repeat(${GRID}, 1fr)` }}>
        {src && <img className="pxing-photo" src={src} alt="" draggable={false} />}
        {cells.map((x, i) => <i key={i} style={{ background: x.c, animationDelay: `${x.d}s` }} />)}
      </span>
      <span className="pxing-bar"><span style={{ width: `${pct}%` }} /></span>
      {label && <span className="pxing-label">PIXELATING…</span>}
    </span>
  );
}
