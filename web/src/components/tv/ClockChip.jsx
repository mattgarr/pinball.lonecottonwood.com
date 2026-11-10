import { useNow } from '../../lib/clock.js';
import { countdown, fmtCountdown } from '../../lib/schedule.js';

// Small always-on countdown: "STARTS IN 12:34" before the tournament, "ENDS IN 1:05:00" during it.
export default function ClockChip({ party, preview = null }) {
  const now = useNow(1000);
  const c = preview || countdown(party, now);
  if (!c) return null;
  const soon = c.kind === 'log' || (c.kind === 'end' && c.ms <= 15 * 60000);
  return (
    <span className={`tv-clock ${c.kind}${soon ? ' soon' : ''}`}>
      <span className="tv-clock-label">{c.label || (c.kind === 'start' ? 'Tournament starts in' : 'Tournament ends in')}</span>
      <span className="tv-clock-time">{fmtCountdown(c.ms)}</span>
    </span>
  );
}
