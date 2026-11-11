// The TV's audio: starts the audio host (lib/audio/tv.js), shows a clear "click for sound" banner
// only while the browser still blocks sound (after a reload), a short notice after a Spotify login,
// and a music button in the bottom-left corner while the mouse is there (connect Spotify / play /
// pause / skip). During the reveal (`reveal` prop) the music is off; the reveal's sounds are planned
// from its timeline (lib/revealTiming.js, `pw:reveal` what 'plan'), ahead of the picture by the Audio delay.
// The Sync test flashes the screen (`pw:syncflash`) at the instant its beep should be heard.
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
  const [flash, setFlash] = useState(0); // Sync test: a white flash at the instant the beep should be heard
  useEffect(() => {
    let t;
    const on = e => { setFlash(e.detail?.n || 1); clearTimeout(t); t = setTimeout(() => setFlash(0), 180); };
    window.addEventListener('pw:syncflash', on);
    return () => { window.removeEventListener('pw:syncflash', on); clearTimeout(t); };
  }, []);
  const host = useRef(null);
  const off = disabled();

  useEffect(() => {
    if (off) return undefined;
    host.current = startAudioHost();
    const un = onAudioState(setSt);
    return () => { un(); stopAudioHost(); };
  }, [off]);

  useEffect(() => { if (!off) host.current?.setReveal(reveal); }, [reveal, off]);

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
      {flash > 0 && <div className="tva-flash" aria-hidden="true"><span>SYNC {flash}</span></div>}
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
