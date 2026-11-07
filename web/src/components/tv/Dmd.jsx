// Amber dot-matrix digits: the text is masked through a dot grid and glows like a DMD.
// `reserve` (the final string) holds the width steady while a number counts up.
// `ghost` adds the faint unlit-dot field behind it (for the big hero numbers).
export default function Dmd({ children, className = '', ghost = false, tone, reserve }) {
  return (
    <span className={`dmd2${ghost ? ' dmd2-ghost' : ''}${tone ? ` dmd2-${tone}` : ''}${reserve != null ? ' dmd2-res' : ''} ${className}`}>
      {reserve != null && <span className="dmd2-lit dmd2-reserve" aria-hidden="true">{reserve}</span>}
      <span className="dmd2-lit">{children}</span>
    </span>
  );
}
