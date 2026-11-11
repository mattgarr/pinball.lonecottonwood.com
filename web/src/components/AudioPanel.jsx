// Host: the "Audio" card. The TV on the Mac plays everything (Spotify music + effects + the
// announcer, all out of the Mac to the WiiM); this card controls it from any phone over the same
// private MQTT channel as the lights: settings (retained, the TV remembers them), commands, and the
// TV's live status. Spotify's login itself happens on the TV Mac (Connect sends the TV to Spotify).
import { useEffect, useRef, useState } from 'react';
import { ensureLightsTopic } from '../lib/store.js';
import { onConnection, publish, subscribe, lightsTopic, onLightsTopic } from '../lib/lights/mqtt.js';
import { AUDIO_DEFAULTS } from '../lib/audio/tv.js';
import { PACK_IDS, PACK_NAMES, clipUrl, lineUrl } from '../lib/audio/voice.js';
import { clockText } from '../lib/audio/lines.js';
import { SAY_TOPICS } from '../lib/audio/policy.js';
import { SPOTIFY_CLIENT_ID, parseSpotifyUri } from '../lib/audio/spotify.js';
import '../audio.css';

const FRESH_MS = 60000;
const TESTS = [
  ['small', 'Score blip'], ['big', 'Big moment'], ['mark', 'Starts in 5'], ['endmark', 'Last call'],
  ['start', 'Tournament on'], ['final', 'Final 10 s'], ['reveal', 'Reveal mute'], ['sting', 'Winner sting'],
  ['grand', 'Grand champ'], ['spin', 'Match spin'],
];
const ANNOUNCE = [['awards', 'Awards soon'], ['freeplay', 'Free play open'], ['timesup', "Time's up"], ['end15', 'Last call']];

export default function AudioPanel() {
  const [settings, setSettings] = useState(AUDIO_DEFAULTS);
  const [tv, setTv] = useState(null);
  const [lists, setLists] = useState(null);
  const [conn, setConn] = useState(false);
  const [topic, setTopic] = useState(lightsTopic());
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState('');
  const [now, setNow] = useState(Date.now());
  const [clientId, setClientId] = useState('');
  const [sayText, setSayText] = useState('');
  const sendTimer = useRef(null);
  const latest = useRef(settings);
  const touched = useRef(0);

  useEffect(() => { ensureLightsTopic().then(t => t && setTopic(t)); return onLightsTopic(setTopic); }, []);
  useEffect(() => {
    const a = subscribe('audio/settings', m => {
      if (!m || typeof m !== 'object' || Date.now() - touched.current < 2500) return;
      const s = { ...AUDIO_DEFAULTS, ...m };
      latest.current = s; setSettings(s); setClientId(s.clientId || '');
    });
    const b = subscribe('audio/state', m => setTv(m && typeof m === 'object' ? m : null));
    const c = subscribe('audio/lists', m => setLists(m && typeof m === 'object' ? m : null));
    const d = onConnection(setConn);
    const iv = setInterval(() => setNow(Date.now()), 5000);
    return () => { a(); b(); c(); d(); clearInterval(iv); };
  }, []);
  // Before the host card has ever saved settings, show what the TV is using.
  useEffect(() => {
    if (tv?.settings && latest.current === AUDIO_DEFAULTS) { const s = { ...AUDIO_DEFAULTS, ...tv.settings }; latest.current = s; setSettings(s); setClientId(s.clientId || ''); }
  }, [tv?.settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = m => { setMsg(m); setTimeout(() => setMsg(x => (x === m ? '' : x)), 4000); };
  const change = (patch, { now: immediate = false } = {}) => {
    const s = { ...latest.current, ...patch };
    latest.current = s; touched.current = Date.now();
    setSettings(s);
    clearTimeout(sendTimer.current);
    const go = () => publish('audio/settings', { ...s, at: Date.now() }, { retain: true });
    if (immediate) go(); else sendTimer.current = setTimeout(go, 250);
  };
  const cmd = (c, extra = {}) => publish('audio/cmd', { cmd: c, at: Date.now(), ...extra });

  const online = tv && !tv.off && now - (tv.at || 0) < FRESH_MS;
  const sp = online ? tv.spotify || {} : {};
  const dot = (ok, label) => <span className="lights-stat"><span className={`ls-dot ${ok === null ? 'idle' : ok ? 'ok' : 'bad'}`} />{label}</span>;
  const pct = v => Math.round((v ?? 0) * 100);
  const playlistOptions = lists?.playlists || [];
  const devices = lists?.devices || [];
  const preview = useRef(null);
  // Preview on this phone: the AI voice saying the sound-check line (the offline clip if it can't).
  const previewHere = async pack => {
    try { preview.current?.pause(); } catch { /* ignore */ }
    say('Getting the voice…');
    const line = await lineUrl(pack, clockText(pack, 'check')).catch(() => null);
    try { preview.current = new Audio(line?.url || clipUrl(pack, 'check')); preview.current.play().catch(() => {}); } catch { /* ignore */ }
  };

  return (
    <section id="sec-audio" className="card audio-card">
      <div className="host-card-head">
        <div><h2>Audio</h2><p className="muted small">Music, sound effects and the announcer, all from the TV's Mac to the WiiM.</p></div>
      </div>
      <div className="lights-status">
        {dot(conn ? !!online : null, online ? 'TV audio online' : 'TV audio not open')}
        {online && dot(!tv.needsClick, tv.needsClick ? 'TV needs one click for sound' : 'Sound on')}
        {online && dot(sp.login ? !!sp.ready || !!sp.device : false, sp.login ? (sp.ready ? 'Spotify ready' : sp.device ? `Spotify: ${sp.device}` : 'Spotify connecting') : 'Spotify not connected')}
        {!conn && <span className="muted small">{topic ? 'Connecting…' : 'Unlock the host page to control the TV'}</span>}
      </div>
      {online && sp.track && <p className="audio-now">♫ {sp.playing ? '' : '(paused) '}{sp.track}{sp.artist ? ` · ${sp.artist}` : ''}</p>}
      {online && sp.error && <p className="audio-err small">{sp.error}</p>}
      {online && (tv.reveal || tv.final || settings.muteAll) && <p className="muted small">{settings.muteAll ? 'Everything is muted.' : tv.reveal ? 'Reveal: music is off until the reveal ends.' : 'Final countdown: music is ducked.'}</p>}

      <div className="audio-btns">
        {sp.login
          ? <>
            <button type="button" className="primary" onClick={() => cmd(sp.playing ? 'pause' : 'play')}>{sp.playing ? 'Pause music' : 'Play music'}</button>
            <button type="button" className="secondary" onClick={() => cmd('next')}>Skip track</button>
            <button type="button" className="secondary" onClick={() => { cmd('refresh'); say('Asked the TV for playlists and devices.'); }}>Refresh lists</button>
          </>
          : <button type="button" className="primary" disabled={!online} onClick={() => { cmd('connect'); say('The TV is opening Spotify: finish the login on the Mac (click Agree).'); }}>Connect Spotify on the TV</button>}
      </div>

      <div className="audio-field">
        <label htmlFor="audio-pl">Playlist</label>
        <div className="audio-line">
          <select id="audio-pl" value={settings.playlist || ''} onChange={e => {
            const p = playlistOptions.find(x => x.uri === e.target.value);
            change({ playlist: e.target.value, playlistName: p?.name || '' }, { now: true });
            if (e.target.value) cmd('playlist', { uri: e.target.value, name: p?.name || '' });
          }}>
            <option value="">{playlistOptions.length ? 'Choose a playlist…' : sp.login ? 'No playlists yet (Refresh lists)' : 'Connect Spotify first'}</option>
            {settings.playlist && !playlistOptions.some(p => p.uri === settings.playlist) && <option value={settings.playlist}>{settings.playlistName || settings.playlist}</option>}
            {playlistOptions.map(p => <option key={p.uri} value={p.uri}>{p.name}{p.n != null ? ` (${p.n})` : ''}</option>)}
          </select>
        </div>
        <div className="audio-line">
          <input type="text" inputMode="url" placeholder="…or paste a playlist link" value={link} onChange={e => setLink(e.target.value)} />
          <button type="button" className="secondary" onClick={() => {
            const uri = parseSpotifyUri(link);
            if (!uri) { say('That doesn’t look like a Spotify playlist link.'); return; }
            change({ playlist: uri, playlistName: '' }, { now: true }); cmd('playlist', { uri }); setLink(''); say('Playing that on the TV.');
          }}>Play link</button>
        </div>
      </div>

      <div className="audio-field">
        <label htmlFor="audio-out">Music plays on</label>
        <div className="audio-line">
          <select id="audio-out" value={settings.output || 'tv'} onChange={e => {
            const d = devices.find(x => x.id === e.target.value);
            change({ output: e.target.value, outputName: d?.name || '' }, { now: true });
          }}>
            <option value="tv">This TV (best)</option>
            {settings.output !== 'tv' && settings.output && !devices.some(d => d.id === settings.output) && <option value={settings.output}>{settings.outputName || 'Saved device'}</option>}
            {devices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.type}) · fallback</option>)}
          </select>
        </div>
        <p className="muted small">This TV: music plays inside the TV page, ducks instantly and mixes with the effects. The other choices (the Spotify app, or the WiiM over Spotify Connect) are fallbacks: slower ducking, and music sent straight to the WiiM doesn't mix with the TV's sounds.</p>
      </div>

      <div className="audio-sliders">
        {[['musicVol', 'Music'], ['fxVol', 'Effects'], ['voiceVol', 'Announcer']].map(([k, label]) => (
          <div className="audio-slider" key={k}>
            <label className="lights-dimmer-head" htmlFor={`audio-${k}`}><span>{label}</span><span className="lights-dimmer-val">{pct(settings[k])}%</span></label>
            <input id={`audio-${k}`} type="range" min={0} max={100} value={pct(settings[k])} onChange={e => change({ [k]: Number(e.target.value) / 100 })} />
          </div>
        ))}
      </div>

      <div className="audio-field">
        <label htmlFor="audio-pack">Announcer voice</label>
        <div className="audio-line">
          <select id="audio-pack" value={settings.pack} onChange={e => change({ pack: e.target.value }, { now: true })}>
            {PACK_IDS.map(id => <option key={id} value={id}>{PACK_NAMES[id]}</option>)}
          </select>
          <button type="button" className="secondary" onClick={() => previewHere(settings.pack)}>Preview here</button>
          <button type="button" className="secondary" onClick={() => cmd('preview', { pack: settings.pack })}>Play on TV</button>
        </div>
        <div className="audio-btns">
          <button type="button" className={settings.voiceOn ? 'secondary' : 'primary'} onClick={() => change({ voiceOn: !settings.voiceOn }, { now: true })}>
            {settings.voiceOn ? 'Announcer: on' : 'Announcer: off'}
          </button>
        </div>
        <div className="audio-label">The announcer talks about (records include new #1s; winners: the reveal)</div>
        <div className="audio-grid">
          {SAY_TOPICS.map(([k, label]) => (
            <button key={k} type="button" className={settings[k] !== false ? 'secondary' : 'ghost'} disabled={!settings.voiceOn} onClick={() => change({ [k]: settings[k] === false }, { now: true })}>
              {label}: {settings[k] !== false ? 'on' : 'off'}
            </button>
          ))}
        </div>
        <form className="audio-line" onSubmit={e => {
          e.preventDefault();
          const text = sayText.trim();
          if (!text) return;
          cmd('say', { text }); setSayText(''); say('Sent to the TV.');
        }}>
          <input type="text" maxLength={300} placeholder="Say something on the TV…" value={sayText} onChange={e => setSayText(e.target.value)} />
          <button type="submit" className="secondary" disabled={!online || !sayText.trim()}>Say it</button>
        </form>
        <p className="muted small">The announcer is an AI voice (Gemini). A brand-new line takes about 5 seconds the first time; the countdowns and the reveal's winners are made ahead of time, so they're instant.</p>
      </div>

      <div className="audio-field">
        <div className="audio-label">Announce now</div>
        <div className="audio-grid">
          {ANNOUNCE.map(([clip, label]) => <button key={clip} type="button" className="secondary" onClick={() => cmd('announce', { clip })}>{label}</button>)}
        </div>
      </div>

      <div className="audio-field">
        <div className="audio-label">Test on the TV</div>
        <div className="audio-grid">
          {TESTS.map(([cue, label]) => <button key={cue} type="button" className="secondary" onClick={() => cmd('test', { cue })}>{label}</button>)}
        </div>
      </div>

      <div className="audio-btns">
        <button type="button" className="secondary" onClick={() => cmd('duck')}>Duck 8 s</button>
        <button type="button" className={settings.muteAll ? 'primary' : 'secondary'} onClick={() => change({ muteAll: !settings.muteAll }, { now: true })}>
          {settings.muteAll ? 'Unmute all' : 'Mute all'}
        </button>
        <button type="button" className="ghost danger" onClick={() => { change({ muteAll: true }, { now: true }); cmd('stopAll'); say('All audio stopped. Tap "Unmute all" to bring it back.'); }}>Stop all audio</button>
      </div>
      {msg && <p className="audio-msg small">{msg}</p>}

      <details className="host-advanced audio-adv">
        <summary>Spotify setup</summary>
        <div className="audio-field">
          <label htmlFor="audio-cid">Spotify Client ID</label>
          <div className="audio-line">
            <input id="audio-cid" type="text" spellCheck={false} placeholder={SPOTIFY_CLIENT_ID} value={clientId} onChange={e => setClientId(e.target.value.trim())} />
            <button type="button" className="secondary" onClick={() => { change({ clientId }, { now: true }); say(clientId ? 'Saved. Press Connect again.' : 'Using the built-in Client ID.'); }}>Save</button>
          </div>
        </div>
        <div className="audio-btns">
          <button type="button" className="secondary" onClick={() => change({ autoplay: !settings.autoplay }, { now: true })}>{settings.autoplay ? 'Autoplay: on' : 'Autoplay: off'}</button>
          <button type="button" className="secondary" onClick={() => change({ shuffle: !settings.shuffle }, { now: true })}>{settings.shuffle ? 'Shuffle: on' : 'Shuffle: off'}</button>
          {sp.login && <button type="button" className="ghost" onClick={() => cmd('connect')}>Reconnect Spotify</button>}
          {sp.login && <button type="button" className="ghost danger" onClick={() => cmd('disconnect')}>Disconnect</button>}
        </div>
        <p className="muted small">Announcer off: minute marks get a chime only. Autoplay: the music starts by itself when the TV gets its click.</p>
        <p className="muted small">The login is saved in the TV Mac's browser only and refreshes itself, so a TV reload doesn't need it again. After a reload the TV needs one click on its screen before it can play sound.</p>
      </details>
    </section>
  );
}
