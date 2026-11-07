import { useEffect } from 'react';
import { useBackClose } from '../lib/useBackClose.js';

// Bottom sheet for phones. Back button / backdrop / ✕ all close it.
export default function Sheet({ open, onClose, title, children, tall = false }) {
  useBackClose(open, onClose);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="sheet-backdrop" aria-label="Close" onClick={onClose} />
      <div className={`sheet${tall ? ' tall' : ''}`}>
        <div className="sheet-head">
          <div className="sheet-grip" aria-hidden="true" />
          <div className="sheet-title">{title}</div>
          <button type="button" className="sheet-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
