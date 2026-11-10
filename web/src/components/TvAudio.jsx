// The TV's audio: starts the audio host (lib/audio/tv.js), shows a clear "click for sound" banner
// only while the browser still blocks sound (after a reload), a short notice after a Spotify login,
// and a music button in the bottom-left corner while the mouse is there (connect Spotify / play /
// pause / skip). During the reveal (`reveal` prop) the music is off and the reveal's walk rows,
// the Match roll and the slot reel get their sounds from what's on screen.
// Rendered through a portal, so the TV board's scaling doesn't affect it.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAudioState, startAudioHost, stopAudioHost } from '../lib/audio/tv.js';
import '../audio.css';

const disabled = () => {
  try { return new URLSearchParams(location.search).get('lights') === 'sim' || window.self !== window.top; } catch { return true; }
};

export default function TvAudio({ reveal = false }) {
  const [st, setSt] = useState(null);
  const [corner, setCorner] = useState(false);
  const host = useRef(null);
  const off = disabled();

  useEffect(() => {
    if (off) return undefined;
    host.current = startAudioHost();
    const un = onAudioState(setSt);
    return () => { un(); stopAudioHost(); };
  }, [off]);

  useEffect(() => { if (!off) host.current?.setReveal(reveal); }, [reveal, off]);
  useRevealSounds(reveal && !off, host);

  useEffect(() => {
    if (off) return undefined;
    let t;
    const move = ev => {
      if (ev.clientX < 520 && ev.clientY > window.innerHeight - 220) {
        setCorner(true); clearTimeout(t); t = setTimeout(() => setCorner(false), 3500);
      }
    };
    window.addEventListener('mousemove', move);
    return () => { window.removeEventListener('mousemove', move); clearTimeout(t); };
  }, [off]);

  if (off || !st) return null;
  const sp = st.spotify || {};
  const locked = !!st.needsClick;
  const cmd = (c, extra) => host.current?.command({ cmd: c, at: Date.now(), ...extra });
  const stop = e => e.stopPropagation();

  return createPortal(
    <>
      {locked && (
        <button type="button" className="tva-unlock" onClick={e => { stop(e); host.current?.unlock(); }}>
          <span className="tva-unlock-big">CLICK FOR SOUND + MUSIC</span>
          <span className="tva-unlock-small">The browser blocks sound after a reload · one click anywhere on this screen</span>
        </button>
      )}
      {st.notice && <div className="tva-notice">{st.notice}</div>}
      {corner && (
        <div className="tva-corner" onClick={stop} onMouseDown={stop}>
          {!sp.login ? (
            <button type="button" className="tva-btn" onClick={() => host.current?.connect()}>♫ Connect Spotify</button>
          ) : (
            <>
              <span className="tva-now">{sp.track ? `♫ ${sp.track}${sp.artist ? ` · ${sp.artist}` : ''}` : sp.error ? `♫ ${sp.error}` : sp.ready ? '♫ Spotify ready' : '♫ Spotify connecting…'}</span>
              <button type="button" className="tva-btn" onClick={() => cmd(sp.playing ? 'pause' : 'play')}>{sp.playing ? 'Pause' : 'Play'}</button>
              <button type="button" className="tva-btn" onClick={() => cmd('next')}>Skip</button>
            </>
          )}
        </div>
      )}
    </>,
    document.body,
  );
}

// Reveal sounds that follow the screen: a ratchet click each time the walk's cursor moves down a
// row, a ding when it lands; the Match number's roll ticks, a ding when it lands, a clack each time
// a player passes the reel's window, and a thunk when the reel stops.
const ITEM_H = 120; // Reveal.jsx MatchSpin item height
function useRevealSounds(active, host) {
  useEffect(() => {
    if (!active) return undefined;
    let raf, walkEl = null, walkRow = -1, walkWon = false;
    let numEl = null, numText = '', numOn = false, reelIdx = null, reelStop = false, lastClack = 0;
    const cue = n => host.current?.revealCue(n);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const w = document.querySelector('.rv-walk');
      if (w !== walkEl) { walkEl = w; walkRow = -1; walkWon = false; }
      if (w) {
        const rows = w.querySelectorAll('.rv-walk-row');
        let here = -1;
        rows.forEach((r, k) => { if (r.classList.contains('here')) here = k; });
        if (here > walkRow && walkRow >= 0) cue('step');
        if (here >= 0) walkRow = here;
        const won = !!w.querySelector('.rv-walk-row.win') || !!w.querySelector('.rv-walk-note.on');
        if (won && !walkWon) cue('land');
        walkWon = won;
      }
      const num = document.querySelector('.rv-spin-num');
      if (num !== numEl) { numEl = num; numText = num?.textContent || ''; numOn = false; reelIdx = null; reelStop = false; }
      if (num) {
        const tx = num.textContent || '';
        if (tx !== numText && !numOn) cue('roll');
        numText = tx;
        const on = num.classList.contains('on');
        if (on && !numOn) cue('land');
        numOn = on;
        const strip = document.querySelector('.rv-reel-strip');
        const reel = document.querySelector('.rv-reel');
        const m = /translateY\((-?[\d.]+)px\)/.exec(strip?.style.transform || '');
        if (m && reel?.classList.contains('on')) {
          const idx = Math.round(1 - Number(m[1]) / ITEM_H);
          const now = performance.now();
          if (reelIdx != null && idx !== reelIdx && now - lastClack > 45) { cue('clack'); lastClack = now; }
          reelIdx = idx;
        }
        const stopped = !!reel?.classList.contains('stopped');
        if (stopped && !reelStop) cue('stop');
        reelStop = stopped;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
}
