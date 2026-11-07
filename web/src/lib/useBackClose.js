import { useEffect, useRef } from 'react';

// While `open`, the phone's Back button closes the overlay instead of leaving the page.
// Pushes a same-URL history entry; closing via the UI pops it again.
//
// history.back() is async, so when one sheet closes and another opens in the same tick we
// must wait for our own pop to land before pushing again, and must not mistake that pop
// for the user pressing Back.
let pendingBacks = 0;
let lastPopWasOurs = false;
let queue = [];
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastPopWasOurs = pendingBacks > 0;
    if (pendingBacks > 0) {
      pendingBacks--;
      if (pendingBacks === 0) { const q = queue; queue = []; q.forEach(f => f()); }
    }
  });
}
const whenSettled = fn => (pendingBacks === 0 ? fn() : queue.push(fn));

export function useBackClose(open, onClose) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!open) return;
    const marker = Math.random().toString(36).slice(2);
    let alive = true;
    let pushed = false;
    let popped = false;
    const onPop = () => {
      if (lastPopWasOurs) return;
      popped = true;
      cb.current?.();
    };
    // Deferred so React StrictMode's mount→unmount→mount in dev doesn't push twice.
    const t = setTimeout(() => whenSettled(() => {
      if (!alive) return;
      window.history.pushState({ ...(window.history.state || {}), pwSheet: marker }, '');
      pushed = true;
      window.addEventListener('popstate', onPop);
    }), 0);
    return () => {
      alive = false;
      clearTimeout(t);
      window.removeEventListener('popstate', onPop);
      if (pushed && !popped && window.history.state?.pwSheet === marker) {
        pendingBacks++;
        window.history.back();
      }
    };
  }, [open]);
}

// Run `fn` (e.g. a navigate()) after a sheet that is closing has popped its history entry.
export function afterSheetClose(fn) {
  setTimeout(() => whenSettled(fn), 30);
}
