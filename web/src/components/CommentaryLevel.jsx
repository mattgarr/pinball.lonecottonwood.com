// Host: how much talking the garage gets, in one tap (Full booth / Chill booth / Announcer only /
// Sound effects only). Writes the TV's retained audio settings over the private MQTT channel (the TV
// applies them within a second or two); the Audio card's toggles below show the same settings, and a
// hand tweak there shows here as "Custom".
import { useEffect, useRef, useState } from 'react';
import { publish, subscribe } from '../lib/lights/mqtt.js';
import { AUDIO_DEFAULTS } from '../lib/audio/tv.js';
import { LEVEL_IDS, LEVEL_NAMES, LEVEL_NOTES, LEVEL_SHORT, applyLevel, levelOf } from '../lib/audio/commentary.js';

export default function CommentaryLevel({ compact = false }) {
  const [settings, setSettings] = useState(null);
  const latest = useRef(null);
  const touched = useRef(0);
  useEffect(() => subscribe('audio/settings', m => {
    if (!m || typeof m !== 'object' || Date.now() - touched.current < 2500) return;
    latest.current = { ...AUDIO_DEFAULTS, ...m };
    setSettings(latest.current);
  }), []);
  const cur = settings || { ...AUDIO_DEFAULTS };
  const level = levelOf(cur);
  const pick = l => {
    const s = applyLevel(latest.current || { ...AUDIO_DEFAULTS }, l);
    latest.current = s; touched.current = Date.now();
    setSettings(s);
    publish('audio/settings', { ...s, at: Date.now() }, { retain: true });
  };
  return (
    <div className={`commentary${compact ? ' compact' : ''}`}>
      <div className="audio-label">Commentary</div>
      <div className="commentary-seg" role="radiogroup" aria-label="Commentary level">
        {LEVEL_IDS.map(l => (
          <button key={l} type="button" role="radio" aria-checked={level === l} title={LEVEL_NAMES[l]} className={level === l ? 'primary' : 'secondary'} onClick={() => pick(l)}>
            {LEVEL_SHORT[l]}
          </button>
        ))}
      </div>
      <p className="muted small"><b>{LEVEL_NAMES[level]}:</b> {LEVEL_NOTES[level]}</p>
    </div>
  );
}
