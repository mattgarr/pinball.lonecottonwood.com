// Host: the "Audio" card. The TV on the Mac plays everything (Spotify music + effects + the
// announcer, all out of the Mac to the WiiM); this card controls it from any phone over the same
// private MQTT channel as the lights: settings (retained, the TV remembers them), commands, and the
// TV's live status. Spotify's login itself happens on the TV Mac (Connect sends the TV to Spotify).
import { useEffect, useRef, useState } from 'react';
import { ensureLightsTopic } from '../lib/store.js';
import { onConnection, publish, subscribe, lightsTopic, onLightsTopic } from '../lib/lights/mqtt.js';
import { AUDIO_DEFAULTS } from '../lib/audio/tv.js';
import { PACK_GROUPS, PACK_NAMES, clipUrl, lineUrl, setSayNames } from '../lib/audio/voice.js';
import { clockText } from '../lib/audio/lines.js';
import { SAY_TOPICS } from '../lib/audio/policy.js';
import { SPOTIFY_CLIENT_ID, parseSpotifyUri } from '../lib/audio/spotify.js';
import CommentaryLevel from './CommentaryLevel.jsx';
import { BOOTH_PERSONAS, boothDuo } from '../lib/audio/booth.js';
import { DEFAULT_DELAY, MAX_DELAY, delayText, effectiveDelay } from '../lib/audio/sync.js';
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
  const [names, setNames] = useState(null); // the "Say names like" field while it's being typed
  useEffect(() => { setSayNames(settings.sayNames); }, [settings.sayNames]);
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

  // A mic sync finished on the TV: save its number (retained, so the TV keeps it after a reload).
  const seenSync = useRef(null);
  useEffect(() => {
    const r = tv?.sync;
    if (!r?.at || r.running) return;
    if (seenSync.current == null) { seenSync.current = r.at; if (Date.now() - r.at > 60000) return; }
    else if (r.at <= seenSync.current) return;
    seenSync.current = r.at;
    if (r.ok && Number.isFinite(r.sec)) change({ audioDelay: Math.max(0, Math.min(MAX_DELAY, Math.round(r.sec * 100) / 100)), delayMode: 'manual', delaySource: 'mic' }, { now: true });
  }, [tv?.sync?.at, tv?.sync?.running]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const booth = online ? tv.booth : null;
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
      <CommentaryLevel />
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
            {PACK_GROUPS.map(([group, ids]) => (
              <optgroup key={group} label={group}>
                {ids.map(id => <option key={id} value={id}>{PACK_NAMES[id]}</option>)}
              </optgroup>
            ))}
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
        <label className="audio-label" htmlFor="audio-names">Say names like… (name=how to say it, commas between)</label>
        <div className="audio-line">
          <input id="audio-names" type="text" spellCheck={false} placeholder="Stacia=Stay-sha, Theo=Thee-oh" value={names ?? settings.sayNames ?? ''}
            onChange={e => setNames(e.target.value)} onBlur={() => { if (names != null) { change({ sayNames: names.trim() }, { now: true }); setNames(null); } }} />
          <button type="button" className="secondary" disabled={names == null} onClick={() => { change({ sayNames: (names || '').trim() }, { now: true }); setNames(null); say('Saved: the TV says those names that way now.'); }}>Save</button>
        </div>
        <p className="muted small">The announcer is an AI voice (Gemini). A brand-new line takes about 5 seconds the first time; the countdowns and the reveal's winners are made ahead of time, so they're instant.</p>
      </div>

      <div className="audio-field">
        <div className="audio-label">Announce booth: two hosts chat about the night every few minutes</div>
        <div className="audio-btns">
          <button type="button" className={settings.boothOn !== false ? 'secondary' : 'ghost'} disabled={!settings.voiceOn} onClick={() => change({ boothOn: settings.boothOn === false }, { now: true })}>
            Booth: {settings.boothOn !== false ? 'on' : 'off'}
          </button>
          <button type="button" className="secondary" disabled={!online || !settings.voiceOn} onClick={() => { cmd('booth'); say('Writing a booth bit: about 10 seconds.'); }}>Play one now</button>
          <button type="button" className="ghost danger" disabled={!booth?.playing} onClick={() => cmd('boothSkip')}>Skip bit</button>
        </div>
        <div className="audio-label booth-sub">In the booth</div>
        <div className="booth-duo">
          {[['boothA', 0], ['boothB', 1]].map(([k, i]) => {
            const duo = boothDuo(settings);
            return (
              <select key={k} aria-label={`Booth host ${i + 1}`} value={duo[i]} onChange={e => {
                const next = [...duo]; next[i] = e.target.value;
                if (next[0] === next[1]) next[1 - i] = duo[i]; // picking the other host's voice swaps them
                change({ boothA: next[0], boothB: next[1] }, { now: true });
              }}>
                {PACK_GROUPS.map(([group, ids]) => (
                  <optgroup key={group} label={group}>
                    {ids.filter(id => BOOTH_PERSONAS[id]).map(id => <option key={id} value={id}>{BOOTH_PERSONAS[id].name} ({PACK_NAMES[id]})</option>)}
                  </optgroup>
                ))}
              </select>
            );
          })}
        </div>
        <p className="muted small">{boothDuo(settings).map(id => `${BOOTH_PERSONAS[id].name}: ${BOOTH_PERSONAS[id].blurb}`).join(' · ')}</p>
        <div className="audio-label booth-sub">How often</div>
        <div className="audio-seg">
          {[['less', 'Less'], ['normal', 'Normal'], ['more', 'More']].map(([v, label]) => (
            <button key={v} type="button" className={(settings.boothFreq || 'normal') === v ? 'primary' : 'secondary'} onClick={() => change({ boothFreq: v }, { now: true })}>{label}</button>
          ))}
        </div>
        <div className="audio-label booth-sub">Roast</div>
        <div className="audio-seg">
          {[['gentle', 'Gentle'], ['spicy', 'Spicy (PG)']].map(([v, label]) => (
            <button key={v} type="button" className={(settings.boothRoast || 'gentle') === v ? 'primary' : 'secondary'} onClick={() => change({ boothRoast: v }, { now: true })}>{label}</button>
          ))}
        </div>
        {booth?.log?.length > 0 && (
          <ol className="booth-log">
            {[...booth.log].reverse().slice(0, 4).map(l => (
              <li key={l.at}>
                <span className="muted small">{new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                {l.lines.map((x, i) => <div key={i} className="small"><b>{x.host.charAt(0) + x.host.slice(1).toLowerCase()}:</b> {x.text}</div>)}
              </li>
            ))}
          </ol>
        )}
        <p className="muted small">Every 6 to 8 minutes in the tournament (10 in free play; Less = half as often), plus one soon after a big moment, only when nothing else is on. Never during the countdowns, the last minutes or the reveal; while results are sealed they don't talk standings. Family-safe: they only tease pinball.</p>
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

      <div className="audio-field audio-delay">
        <div className="audio-label">Audio delay: the countdown boops, GAME OVER beep and reveal sounds play this much ahead of the screen (AirPlay to the WiiM runs about 2 s behind)</div>
        <p className="audio-delay-now"><b>{online && tv.delay ? delayText(tv.delay) : settings.delayMode === 'manual' ? delayText(effectiveDelay(settings, null)) : `Auto (the Mac's number, else ${Number(settings.audioDelay ?? DEFAULT_DELAY).toFixed(1)} s)`}</b></p>
        <div className="audio-seg">
          <button type="button" className={settings.delayMode !== 'manual' ? 'primary' : 'secondary'} onClick={() => change({ delayMode: 'auto', delaySource: '' }, { now: true })}>Auto</button>
          <button type="button" className={settings.delayMode === 'manual' ? 'primary' : 'secondary'} onClick={() => change({ delayMode: 'manual' }, { now: true })}>Manual</button>
        </div>
        <div className="audio-slider">
          <label className="lights-dimmer-head" htmlFor="audio-delay"><span>{settings.delayMode === 'manual' ? 'Delay' : 'Fallback'}</span><span className="lights-dimmer-val">{Number(settings.audioDelay ?? DEFAULT_DELAY).toFixed(2)} s</span></label>
          <input id="audio-delay" type="range" min={0} max={MAX_DELAY * 100} step={5} value={Math.round(Number(settings.audioDelay ?? DEFAULT_DELAY) * 100)}
            onChange={e => change({ audioDelay: Number(e.target.value) / 100, delaySource: '' })} />
        </div>
        <div className="audio-btns">
          <button type="button" className="secondary" disabled={!online} onClick={() => { cmd('synctest'); say('Listen in the garage: each beep should land on a white flash.'); }}>Sync test</button>
          <button type="button" className="secondary" disabled={!online || !!tv?.sync?.running} onClick={() => { cmd('micsync'); say('The TV is listening with the Mac’s microphone (about 25 s). Allow the microphone on the Mac if Chrome asks.'); }}>Auto sync with mic</button>
        </div>
        {online && tv.sync && (
          <p className={`small ${tv.sync.running || tv.sync.ok ? 'muted' : 'audio-err'}`}>
            {tv.sync.running ? `Listening… ${tv.sync.done || 0} of ${tv.sync.runs || 5} chirps`
              : tv.sync.ok ? `Mic sync: ${tv.sync.sec.toFixed(2)} s · confidence ${tv.sync.confidence} (${tv.sync.good} of ${tv.sync.runs} chirps heard, spread ${Math.round((tv.sync.spread || 0) * 1000)} ms). Saved as Manual.`
                : tv.sync.error}
          </p>
        )}
        <p className="muted small">Auto: uses the delay the Mac reports for AirPlay, else the number above (2.0 s is AirPlay’s usual). Auto sync with mic measures it in the garage. Sync test: three beeps, the TV flashes white where each should land; adjust until they match. Connected by cable or HDMI instead of AirPlay? Choose Manual and set it near 0.</p>
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
