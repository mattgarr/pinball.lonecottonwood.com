import { useEffect, useRef, useState } from 'react';

// Animate a number from its previous value to the new one (ease-out cubic).
export function useCountUp(value, ms = 650) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);

  return display;
}

// Small render helper: <CountUp value={n} format={fmt} />
export function CountUp({ value, ms, format }) {
  const d = useCountUp(value, ms);
  return format ? format(d) : d;
}
