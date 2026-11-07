import { useEffect } from 'react';
import LedNumber from './LedNumber.jsx';
import { sayNumber } from '../lib/plausibility.js';

const MAX_DIGITS = 11;
const buzz = () => { try { navigator.vibrate?.(8); } catch { /* not supported */ } };

// Controlled keypad. `value` is a digit string. Shows the number live, comma-grouped,
// plus "≈ 2.53 million · 7 digits" so a missing zero is obvious before you hit Next.
export default function ScorePad({ value, onChange, hint }) {
  const push = d => { buzz(); onChange((value + d).replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS)); };
  const back = () => { buzz(); onChange(value.slice(0, -1)); };
  const clear = () => { buzz(); onChange(''); };

  // Hardware keyboards (and desktop testing).
  useEffect(() => {
    const onKey = e => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); onChange((value + e.key).replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS)); }
      else if (e.key === 'Backspace') { e.preventDefault(); onChange(value.slice(0, -1)); }
      else if (e.key === 'Escape') onChange('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onChange]);

  const n = Number(value || 0);
  return (
    <div className="pad-wrap">
      <LedNumber value={value} size="lg" blink placeholder="0" />
      <div className="pad-say" aria-live="polite">
        {value ? <>≈ {sayNumber(n)} <span className="pad-digits">· {value.length} digit{value.length === 1 ? '' : 's'}</span></> : (hint || 'Type it exactly as shown')}
      </div>
      <div className="pad" role="group" aria-label="Number pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
          <button key={d} type="button" className="pad-key" onClick={() => push(d)}>{d}</button>
        ))}
        <button type="button" className="pad-key pad-fn" onClick={clear} aria-label="Clear">C</button>
        <button type="button" className="pad-key" onClick={() => push('0')}>0</button>
        <button type="button" className="pad-key pad-fn" onClick={back} aria-label="Delete last digit">⌫</button>
      </div>
    </div>
  );
}
