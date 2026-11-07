// Minimal line-icon set (currentColor stroke) — replaces emoji on the TV board so the
// iconography is consistent and "designed" rather than toy-like.
const PATHS = {
  crown:   'M4 18h16M4 18l-1.2-9.5 5 3.8L12 5.5l4.2 6.8 5-3.8L20 18',
  skull:   'M12 3a7 7 0 0 0-4 12.7V18a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 18v-2.3A7 7 0 0 0 12 3ZM9 11.5h0M15 11.5h0M11 15.5h2',
  trophy:  'M7 4h10v4a5 5 0 0 1-10 0V4ZM7 6.5H4.5V8a3 3 0 0 0 3 3M17 6.5h2.5V8a3 3 0 0 1-3 3M9.5 18.5h5M12 13v5.5',
  star:    'M12 4l2.3 4.8 5.2.7-3.8 3.6 1 5.2L12 16l-4.7 2.3 1-5.2L4.5 9.5l5.2-.7L12 4Z',
  grind:   'M4.5 10a7.5 7.5 0 0 1 12.7-3.3L20 9M20 4.5V9h-4.5M19.5 14a7.5 7.5 0 0 1-12.7 3.3L4 15M4 19.5V15h4.5',
  globe:   'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM3.5 12h17M12 3.5c2.4 2.4 2.4 14.6 0 17M12 3.5c-2.4 2.4-2.4 14.6 0 17',
  burst:   'M12 3l1.7 3.9 3.9-1.6-1.6 3.9L20 11l-3.9 1.7 1.6 3.9-3.9-1.6L12 21l-1.7-3.9-3.9 1.6 1.6-3.9L4 11l3.9-1.8-1.6-3.9 3.9 1.6L12 3Z',
  ticket:  'M4.5 8.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2 1.8 1.8 0 0 0 0 3.6 1.8 1.8 0 0 1-2 1.8v.6a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2 1.8 1.8 0 0 0 0-3.6ZM13.5 7v10',
  medal:   'M8.5 3.5l3.5 6 3.5-6M9 14.5a3.5 3.5 0 1 0 6 0 3.5 3.5 0 0 0-6 0ZM12 16.5h0',
  flame:   'M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c0-1-.5-1.5-.5-2.5C15 9 16 11 16 13a4 4 0 0 1-8 0c0-3 3-4 4-10Z',
};

export default function Icon({ name, size = 20, className = '', stroke = 1.9 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      className={`icon ${className}`} aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
