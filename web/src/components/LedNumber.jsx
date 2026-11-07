// Amber dot-matrix "DMD" style number. Digits are grouped with commas.
// size: 'xl' (confirm/success), 'lg' (keypad), 'md' (rows), 'sm' (inline)
export default function LedNumber({ value, size = 'lg', placeholder = '0', blink = false, className = '', onClick, label }) {
  const has = value !== '' && value != null;
  const text = has ? Number(value).toLocaleString('en-US') : placeholder;
  const len = text.length;
  // shrink long numbers so 11 digits + commas still fit on a 320px-wide phone
  const fit = size === 'xl' ? (len <= 7 ? 1 : len <= 10 ? 0.86 : len <= 13 ? 0.7 : 0.6)
    : size === 'lg' ? (len <= 9 ? 1 : len <= 11 ? 0.88 : 0.74)
    : 1;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`led led-${size}${has ? '' : ' led-empty'}${className ? ' ' + className : ''}`}
      onClick={onClick}
      aria-label={label ?? (has ? `score ${text}` : 'no score yet')}
    >
      <span className="led-text" style={{ fontSize: `calc(var(--led-fs) * ${fit})` }}>
        {text}{blink && <span className="led-caret" aria-hidden="true">▌</span>}
      </span>
    </Tag>
  );
}
