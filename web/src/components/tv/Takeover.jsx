import { useEffect, useState } from 'react';
import Avatar from '../Avatar.jsx';
import Confetti from '../Confetti.jsx';
import PixelEmoji from '../PixelEmoji.jsx';
import Backbox from './Backbox.jsx';
import Dmd from './Dmd.jsx';
import { fmt, fmtShort, ordinal } from '../../lib/scoring.js';
import { artFallback, machineArt, machineGlow } from './theme.js';

export const TAKEOVER_MS = 6500;
export const SPOTLIGHT_MS = 7500;

// Count from `from` to `to` after `delay` ms, ease-out.
export function useRamp(from, to, ms = 2200, delay = 600) {
  const [v, setV] = useState(from);
  useEffect(() => {
    let raf, t0;
    const tick = now => {
      t0 ??= now;
      const t = Math.min(1, (now - t0) / ms);
      setV(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    const to_ = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => { clearTimeout(to_); cancelAnimationFrame(raf); };
  }, [from, to, ms, delay]);
  return v;
}

// Full-canvas celebration or arcade attract spotlight. Mount with key={item.id}; calls onDone when finished.
export default function Takeover(props) {
  const k = props.item.kind;
  if (k === 'leader') return <LeaderTakeover {...props} />;
  if (k === 'ranked') return <RankedTakeover {...props} />;
  if (k === 'milestone') return <MilestoneTakeover {...props} />;
  if (k === 'spotlight') return <SpotlightTakeover {...props} />;
  if (k === 'clock') return <ClockTakeover {...props} />;
  return <RecordTakeover {...props} />;
}

// "NEW LEADER": someone took overall #1.
function LeaderTakeover({ item, onDone, queued = 0 }) {
  const [leaving, setLeaving] = useState(false);
  const shown = useRamp(0, item.rating, 1800, 900);
  const p = item.player;
  useEffect(() => {
    if (item.pinned) return;
    const a = setTimeout(() => setLeaving(true), TAKEOVER_MS - 550);
    const b = setTimeout(onDone, TAKEOVER_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [onDone, item.pinned]);
  return (
    <div className={`to to-leader${leaving ? ' out' : ''}`} style={{ '--glow': '#f8b800' }}>
      <div className="to-shade" />
      <div className="to-rays" />
      <Confetti count={180} seed={item.rating * 7} />
      <div className="to-marquee">
        <span className="to-bulbs" />
        <span className="to-title">NEW LEADER</span>
        <span className="to-bulbs r" />
      </div>
      <div className="to-lead-body">
        <div className="to-lead-crown"><PixelEmoji e="👑" size={96} grid={16} /></div>
        <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={200} ring />
        <div className="to-pname to-lead-name">{p.display_name}</div>
        <div className="to-lead-rating">RATING <Dmd ghost tone="hot" className="to-score" reserve="100">{shown}</Dmd></div>
        <div className="to-sub">{item.prevPlayer ? <>took #1 from <b>{item.prevPlayer.display_name}</b></> : <>first player ranked #1</>}</div>
      </div>
      {queued > 0 && <div className="to-queued">+{queued} more</div>}
      <div className="to-timer" style={{ animationDuration: `${TAKEOVER_MS}ms` }} />
    </div>
  );
}

// "RANKING UNLOCKED": player completed their 2nd machine and entered the overall standings!
function RankedTakeover({ item, onDone, queued = 0 }) {
  const [leaving, setLeaving] = useState(false);
  const shown = useRamp(0, item.rating, 1600, 700);
  const p = item.player;
  useEffect(() => {
    if (item.pinned) return;
    const a = setTimeout(() => setLeaving(true), TAKEOVER_MS - 550);
    const b = setTimeout(onDone, TAKEOVER_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [onDone, item.pinned]);
  return (
    <div className={`to to-leader to-ranked${leaving ? ' out' : ''}`} style={{ '--glow': '#3cbcfc' }}>
      <div className="to-shade" />
      <div className="to-rays" />
      <Confetti count={110} seed={(item.rating || 50) * 13} />
      <div className="to-marquee">
        <span className="to-bulbs" />
        <span className="to-title">RANKING UNLOCKED</span>
        <span className="to-bulbs r" />
      </div>
      <div className="to-lead-body">
        <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={184} ring />
        <div className="to-pname to-lead-name">{p.display_name}</div>
        <div className="to-lead-rating">
          DEBUTS AT <b>#{item.rank}</b> · RATING <Dmd ghost tone="hot" className="to-score" reserve="100">{shown}</Dmd>
        </div>
        <div className="to-sub">2 machines played · officially on the board!</div>
      </div>
      {queued > 0 && <div className="to-queued">+{queued} more</div>}
      <div className="to-timer" style={{ animationDuration: `${TAKEOVER_MS}ms` }} />
    </div>
  );
}

// "PARTY MILESTONE": 25 / 50 / 75 / 100+ games logged tonight!
function MilestoneTakeover({ item, onDone, queued = 0 }) {
  const [leaving, setLeaving] = useState(false);
  const shown = useRamp(0, item.count, 1600, 500);
  const p = item.player;
  useEffect(() => {
    if (item.pinned) return;
    const a = setTimeout(() => setLeaving(true), TAKEOVER_MS - 550);
    const b = setTimeout(onDone, TAKEOVER_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [onDone, item.pinned]);
  return (
    <div className={`to to-leader to-milestone${leaving ? ' out' : ''}`} style={{ '--glow': '#f878f8' }}>
      <div className="to-shade" />
      <div className="to-rays" />
      <Confetti count={150} seed={item.count * 19} />
      <div className="to-marquee">
        <span className="to-bulbs" />
        <span className="to-title">PARTY MILESTONE</span>
        <span className="to-bulbs r" />
      </div>
      <div className="to-lead-body">
        <div className="to-lead-crown"><PixelEmoji e="🎉" size={88} grid={16} /></div>
        <Dmd ghost tone="hot" className="to-score" reserve="999 GAMES">{shown} GAMES PLAYED</Dmd>
        {p && (
          <div className="to-mile-who">
            <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={84} ring />
            <div className="to-sub">
              Game #{item.count} logged by <b>{p.display_name}</b>
              {item.machine ? <> on <b>{item.machine.name}</b></> : null}
            </div>
          </div>
        )}
      </div>
      {queued > 0 && <div className="to-queued">+{queued} more</div>}
      <div className="to-timer" style={{ animationDuration: `${TAKEOVER_MS}ms` }} />
    </div>
  );
}

// "NEW HIGH SCORE" on one machine.
function RecordTakeover({ item, onDone, queued = 0 }) {
  const [leaving, setLeaving] = useState(false);
  const shown = useRamp(item.prevScore, item.score, 2300, 700);
  const p = item.player, m = item.machine;

  useEffect(() => {
    if (item.pinned) return;
    const a = setTimeout(() => setLeaving(true), TAKEOVER_MS - 550);
    const b = setTimeout(onDone, TAKEOVER_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [onDone, item.pinned]);

  const sub = item.prevPlayer
    ? <>dethroned <b>{item.prevPlayer.display_name}</b> · {fmt(item.prevScore)}</>
    : item.selfBeat
      ? <>beat their own record of {fmt(item.prevScore)}</>
      : <>first score on the board</>;

  return (
    <div className={`to${leaving ? ' out' : ''}`} style={{ '--glow': machineGlow(m.name) }}>
      <img className="to-bg" src={machineArt(m.name)} alt="" onError={e => artFallback(e, m.name)} />
      <div className="to-shade" />
      <div className="to-rays" />
      <Confetti count={140} seed={item.score % 997} />

      <div className="to-marquee">
        <span className="to-bulbs" />
        <span className="to-title">NEW HIGH SCORE</span>
        <span className="to-bulbs r" />
      </div>

      <div className="to-body">
        <Backbox machine={m} className="to-bb" />
        <div className="to-info">
          <div className="to-machine">{m.name}<span>{m.manufacturer} · {m.year}</span></div>
          <div className="to-player">
            <Avatar avatar={p.avatar} emoji={p.emoji} name={p.display_name} color={p.color} size={132} ring />
            <div className="to-pname">{p.display_name}</div>
          </div>
          <Dmd ghost tone="hot" className="to-score" reserve={fmt(item.score)}>{fmt(shown)}</Dmd>
          <div className="to-sub">{sub}</div>
        </div>
      </div>
      {queued > 0 && <div className="to-queued">+{queued} more new record{queued > 1 ? 's' : ''}</div>}
      <div className="to-timer" style={{ animationDuration: `${TAKEOVER_MS}ms` }} />
    </div>
  );
}

// Periodic Quiet-Room Arcade Attract Spotlight (Rivalry, Crown Bounty / Open Table, or Machine Pro Tip).
function SpotlightTakeover({ item, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const m = item.machine;

  useEffect(() => {
    if (item.pinned) return;
    const a = setTimeout(() => setLeaving(true), SPOTLIGHT_MS - 550);
    const b = setTimeout(onDone, SPOTLIGHT_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [onDone, item.pinned]);

  const title = item.subkind === 'rivalry'
    ? 'CLOSEST BATTLE'
    : item.subkind === 'bounty'
    ? (item.bountyType === 'open' ? 'OPEN TABLE' : 'CROWN BOUNTY')
    : 'TABLE SPOTLIGHT';

  return (
    <div className={`to to-spotlight${leaving ? ' out' : ''}`} style={{ '--glow': machineGlow(m.name) }}>
      <img className="to-bg" src={machineArt(m.name)} alt="" onError={e => artFallback(e, m.name)} />
      <div className="to-shade" />
      <div className="to-rays" />

      <div className="to-marquee">
        <span className="to-bulbs" />
        <span className="to-title">{title}</span>
        <span className="to-bulbs r" />
      </div>

      <div className="to-body">
        <Backbox machine={m} className="to-bb" />
        <div className="to-info">
          <div className="to-machine">{m.name}<span>{m.manufacturer} · {m.year}</span></div>

          {item.subkind === 'rivalry' && (
            <>
              <div className="to-vs-row">
                <div className="to-vs-card">
                  <span className="to-vs-rank">#1</span>
                  <Avatar avatar={item.leader.player.avatar} emoji={item.leader.player.emoji} name={item.leader.player.display_name} color={item.leader.player.color} size={84} ring />
                  <div className="to-vs-name">{item.leader.player.display_name}</div>
                  <div className="to-vs-score">{fmtShort(item.leader.score)}</div>
                </div>
                <div className="to-vs-badge">VS</div>
                <div className="to-vs-card">
                  <span className="to-vs-rank">#2</span>
                  <Avatar avatar={item.challenger.player.avatar} emoji={item.challenger.player.emoji} name={item.challenger.player.display_name} color={item.challenger.player.color} size={84} ring />
                  <div className="to-vs-name">{item.challenger.player.display_name}</div>
                  <div className="to-vs-score">{fmtShort(item.challenger.score)}</div>
                </div>
              </div>
              <Dmd ghost tone="hot" className="to-score to-score-md">{fmt(item.gap)} APART</Dmd>
              <div className="to-sub">Tightest #1 race on the floor right now!</div>
            </>
          )}

          {item.subkind === 'bounty' && item.bountyType === 'crown' && item.champion && (
            <>
              <div className="to-player">
                <Avatar avatar={item.champion.player.avatar} emoji={item.champion.player.emoji} name={item.champion.player.display_name} color={item.champion.player.color} size={116} ring />
                <div className="to-pname">{item.champion.player.display_name}</div>
              </div>
              <Dmd ghost tone="hot" className="to-score">{fmt(item.champion.score)}</Dmd>
              <div className="to-sub">
                Undefeated for <b>{item.mins} min</b> · Who knocks them off #1?
              </div>
            </>
          )}

          {item.subkind === 'bounty' && item.bountyType === 'open' && (
            <>
              <Dmd ghost tone="hot" className="to-score to-score-md">
                {item.N === 0 ? 'WIDE OPEN!' : `ONLY ${item.N} SCORE${item.N === 1 ? '' : 'S'}`}
              </Dmd>
              <div className="to-sub">
                <b>{item.needCount} players</b> still haven't logged a score here — easy rating points!
              </div>
            </>
          )}

          {item.subkind === 'tip' && (
            <div className="to-tip-stack">
              {item.champion ? (
                <div className="to-tip-champ">
                  <span>CURRENT #1:</span>
                  <Avatar avatar={item.champion.player.avatar} emoji={item.champion.player.emoji} name={item.champion.player.display_name} color={item.champion.player.color} size={36} />
                  <b>{item.champion.player.display_name}</b>
                  <span>· {fmtShort(item.champion.score)}</span>
                </div>
              ) : (
                <div className="to-tip-champ"><b>CROWN UP FOR GRABS!</b></div>
              )}
              <div className="to-tip-box">
                <div className="to-tip-kicker">★ PRO TIP</div>
                <div className="to-tip-text">{item.tip}</div>
              </div>
              {item.fact && (
                <div className="to-tip-box fact">
                  <div className="to-tip-kicker">💡 DID YOU KNOW?</div>
                  <div className="to-tip-text">{item.fact}</div>
                </div>
              )}
              {item.needCount > 0 && (
                <div className="to-tip-foot">{item.needCount} player{item.needCount === 1 ? '' : 's'} still need {m.name}</div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="to-timer" style={{ animationDuration: `${SPOTLIGHT_MS}ms` }} />
    </div>
  );
}

// Tournament clock: "starts in 5 minutes" … "TOURNAMENT IS ON", "ends in 15 minutes" … "END OF TOURNAMENT".
export const CLOCK_MS = 6000;
export function ClockTakeover({ item, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const start = item.side === 'start', zero = item.minutes === 0;
  const ms = zero ? 9000 : CLOCK_MS;
  useEffect(() => {
    if (item.pinned) return;
    const a = setTimeout(() => setLeaving(true), ms - 550);
    const b = setTimeout(onDone, ms);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [onDone, item.pinned, ms]);
  const glow = start ? '#58d854' : item.minutes > 5 ? '#f8b800' : '#e40058';
  const at = t => (t ? new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) : '');
  const ends = at(item.target), closes = at(item.target ? item.target + 3 * 60000 : 0);
  const title = start
    ? (zero ? 'TOURNAMENT IS ON' : 'TOURNAMENT STARTS IN')
    : zero ? 'END OF TOURNAMENT'
    : item.minutes === 15 ? 'LAST CALL'
    : item.minutes === 5 ? 'START YOUR LAST GAME NOW'
    : 'TOURNAMENT ENDS IN';
  const sub = start
    ? (zero ? 'Every score counts from now on. Go!' : "Warm up now: free play scores don't count")
    : zero ? <>Snap your last score now{closes ? <>: logging closes at <b>{closes}</b></> : null}. Results sealed until the awards!</>
    : item.minutes === 15 ? <>Play ends {ends || 'soon'}{closes ? <> · logging closes {closes}</> : null}</>
    : item.minutes <= 5 ? 'Last chance: get your best games in!'
    : 'Get your scores in before the buzzer';
  return (
    <div className={`to to-leader to-clock ${start ? 'start' : 'end'}${zero ? ' zero' : ''}${leaving ? ' out' : ''}`} style={{ '--glow': glow }}>
      <div className="to-shade" />
      <div className="to-rays" />
      {zero && start && <Confetti count={160} seed={(item.target || 7) % 997} />}
      <div className="to-marquee">
        <span className="to-bulbs" />
        <span className="to-title">{title}</span>
        <span className="to-bulbs r" />
      </div>
      <div className="to-clock-body">
        {!zero && <div className="to-clock-num">{item.minutes}<span>{item.minutes === 1 ? 'MINUTE' : 'MINUTES'}</span></div>}
        {zero && start && <div className="to-clock-icon"><PixelEmoji e="🏁" size={128} grid={16} /></div>}
        {zero && !start && <Dmd ghost tone="red" className="to-gameover">GAME OVER</Dmd>}
        <div className="to-sub">{sub}</div>
      </div>
      <div className="to-timer" style={{ animationDuration: `${ms}ms` }} />
    </div>
  );
}

// The last 10 seconds before the end: one big number per second, over everything.
export function FinalCountdown({ n }) {
  return (
    <div className="to to-clock end final" style={{ '--glow': '#e40058' }}>
      <div className="to-shade" />
      <div className="to-final-label">TOURNAMENT ENDS IN</div>
      <div className="to-final-num" key={n}>{n}</div>
      <div className="to-final-label small">Finish your ball!</div>
    </div>
  );
}
