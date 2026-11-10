import { useEffect, useState } from 'react';
import Avatar from './Avatar.jsx';
import Confetti from './Confetti.jsx';
import Icon from './Icon.jsx';
import Backbox from './tv/Backbox.jsx';
import Dmd from './tv/Dmd.jsx';
import { artFallback, machineArt, machineGlow } from './tv/theme.js';
import { useRamp } from './tv/Takeover.jsx';
import '../tv.css';

const fmt = n => Number(n).toLocaleString();
const COUNT_MS = 1000; // each number of the 3-2-1
const ordinal = n => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

// The reveal, one prize at a time: fun prizes, then machine champions, then 3rd, 2nd and the Grand
// Champion last. Each prize: its name and a 3-2-1 countdown, then the winner, then it waits for the
// host (`step` from the party, via the host page's Next / Back) or a click / Space / arrow key here.
export default function Reveal({ standings, awards, onSlide, step = 0, onStep }) {
  const slides = buildSlides({ standings, awards });
  const last = Math.max(0, slides.length - 1);
  const [idx, setIdx] = useState(Math.min(step, last));
  useEffect(() => { setIdx(Math.min(step, last)); }, [step, last]);
  const go = n => {
    const next = Math.max(0, Math.min(last, n));
    if (next === idx) return;
    setIdx(next);
    onStep?.(next);
  };
  useEffect(() => {
    const key = e => {
      if (['ArrowRight', ' ', 'Enter', 'PageDown'].includes(e.key)) { e.preventDefault(); go(idx + 1); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(idx - 1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // 3, 2, 1, then the winner (count 0). The lights get each count and the reveal, on the same timeline.
  const cur = slides[idx] ?? slides[0];
  const cueKey = cur ? `${idx}:${cur.label}:${cur.title || ''}` : '';
  const [count, setCount] = useState(3);
  useEffect(() => {
    if (!cur) return undefined;
    setCount(3);
    onSlide?.(cur, 'count', 3);
    const ts = [2, 1].map((n, k) => setTimeout(() => { setCount(n); onSlide?.(cur, 'count', n); }, COUNT_MS * (k + 1)));
    ts.push(setTimeout(() => { setCount(0); onSlide?.(cur, 'show'); }, COUNT_MS * 3));
    return () => ts.forEach(clearTimeout);
  }, [cueKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const slide = slides[idx] ?? slides[0];
  if (!slide) return <div className="reveal-tv rv"><div className="rv-empty">No data to reveal yet.</div></div>;

  const accent = slide.accent || '#ffcc33';
  const split = !!slide.machine;

  if (count > 0) {
    return (
      <div className="reveal-tv rv rv-counting" style={{ '--accent': accent, '--slide-ms': `${COUNT_MS * 3}ms` }} onClick={() => go(idx + 1)}>
        {slide.machine && <img key={`bg${idx}`} className="rv-bg" src={machineArt(slide.machine.name)} alt="" onError={e => artFallback(e, slide.machine.name)} />}
        <div className="rv-shade" />
        <div className="rv-top" key={`top${idx}`}><div className="rv-pill">{slide.label}</div></div>
        <div className="rv-countdown">
          <div className="rv-count-lead">And the winner is…</div>
          <div className="rv-count-num" key={`n${idx}-${count}`}>{count}</div>
        </div>
        <Dots slides={slides} idx={idx} />
      </div>
    );
  }

  return (
    <div className="reveal-tv rv" style={{ '--accent': accent, '--slide-ms': '1ms' }} onClick={() => go(idx + 1)}>
      {slide.machine && <img key={`bg${idx}`} className="rv-bg" src={machineArt(slide.machine.name)} alt="" onError={e => artFallback(e, slide.machine.name)} />}
      {slide.machine && <div className="rv-shade" />}
      <div className="rv-glow" />
      {slide.rays && <div className="rv-rays" />}
      {slide.confetti && <Confetti key={`c${idx}`} count={130} seed={idx} />}

      <div className="rv-top" key={`top${idx}`}><div className="rv-pill">{slide.label}</div></div>

      <div className={`rv-stage${split ? ' split' : ''}${slide.trophy ? ' tall' : ''}`} key={`s${idx}`}>
        {split && <Backbox machine={slide.machine} className="rv-split-bb" />}
        <div className={split ? 'rv-split-info' : 'rv-center'} style={split ? null : { display: 'contents' }}>
          {slide.trophy && <div className="rv-trophy"><Icon name="trophy" size={110} stroke={1.6} /></div>}
          {slide.hero && (
            <div className="rv-hero">
              <Avatar avatar={slide.hero.avatar} emoji={slide.hero.emoji} name={slide.hero.name} color={slide.hero.color} size={split ? 150 : slide.trophy ? 140 : 170} />
            </div>
          )}
          {slide.list ? (
            <ul className="rv-list">{slide.list.map((item, k) => (
              <li key={k}>
                <Avatar avatar={item.player.avatar} emoji={item.player.emoji} name={item.player.display_name} color={item.player.color} size={52} />
                {item.player.display_name}{item.note && <small>{item.note}</small>}
              </li>
            ))}</ul>
          ) : (
            <div className="rv-title">{slide.title}</div>
          )}
          {slide.subtitle && <div className="rv-sub">{slide.subtitle}</div>}
          {slide.score != null && slide.score !== '' && (
            <Dmd ghost tone="hot" className="rv-score" reserve={slide.scoreCount ? fmt(slide.score) : undefined}>
              {slide.scoreCount ? <Ramp value={slide.score} /> : slide.score}
            </Dmd>
          )}
          {slide.footer && <div className="rv-footer">{slide.footer}</div>}
        </div>
      </div>

      <Dots slides={slides} idx={idx} />
    </div>
  );
}

function Dots({ slides, idx }) {
  return (
    <div className="rv-dots">
      {slides.map((_, i) => <span key={i === idx ? `on${idx}` : i} className={`rv-dot${i === idx ? ' on' : i < idx ? ' done' : ''}`} />)}
    </div>
  );
}

// For the host page: what each step of the reveal shows.
export function revealPlan({ standings, awards }) {
  return buildSlides({ standings, awards }).map(s => ({ label: s.label, title: s.title }));
}

function Ramp({ value }) {
  return fmt(useRamp(0, Number(value) || 0, 1600, 450));
}

const hero = p => p && { avatar: p.avatar, emoji: p.emoji, name: p.display_name, color: p.color };

function buildSlides({ standings, awards }) {
  const slides = [];

  // Fun prizes first.
  if (awards?.theMatch) {
    const t = awards.theMatch;
    slides.push({
      label: 'THE MATCH', confetti: true, hero: hero(t.player), title: t.player.display_name,
      subtitle: `Drawn: ${String(t.drawn).padStart(2, '0')} · on ${t.machine.name}`,
      score: t.value, scoreCount: true, accent: '#29d4d4', footer: 'pure luck, the best kind 🎰',
    });
  }
  if (awards?.bigWhiff) {
    const w = awards.bigWhiff;
    slides.push({
      label: 'THE BIG WHIFF', confetti: false, hero: hero(w.player), title: w.player.display_name,
      subtitle: w.worst
        ? `Lowlight: ${ordinal(w.worst.rank)} of ${w.worst.N} on ${w.worst.machineName}`
        : `${w.machinesPlayed} machines played`,
      score: `${w.rating}/100`, accent: '#ff5b5b', footer: 'a humble effort, bravely made 🤝',
    });
  }
  if (awards?.grinder) {
    const g = awards.grinder;
    slides.push({
      label: 'THE GRINDER', confetti: true, hero: hero(g.player), title: g.player.display_name,
      subtitle: `${g.plays} games logged`, accent: '#4d8bff', footer: 'absolutely sent it 💪',
    });
  }

  // A champion for each machine.
  for (const c of awards?.machineChamps ?? []) {
    if (!c.player) continue;
    const m = c.machine;
    slides.push({
      label: `${m.name.toUpperCase()} CHAMPION`, confetti: true, hero: hero(c.player), machine: m,
      title: c.player.display_name, subtitle: `${m.manufacturer} · ${m.year}`,
      score: c.score, scoreCount: true, accent: machineGlow(m.name),
      footer: c.rank > 1 ? 'next in line: the top scorer already won a prize 👑' : '👑',
    });
  }

  // The podium, saving the best for last.
  const podium = [
    [awards?.third, '3RD PLACE', '#cd7f32', '🥉'],
    [awards?.second, '2ND PLACE', '#c0c7d4', '🥈'],
  ];
  for (const [st, label, accent, footer] of podium) {
    if (!st) continue;
    slides.push({
      label, confetti: true, hero: hero(st.player), title: st.player.display_name,
      subtitle: `${st.machinesPlayed} machines played`, score: `${st.rating}/100`, accent, footer,
    });
  }
  const champ = awards?.champion;
  if (champ) {
    slides.push({
      label: 'GRAND CHAMPION', trophy: true, confetti: true, rays: true, hero: hero(champ.player),
      title: champ.player.display_name,
      subtitle: `The Pinball Wizard · ${champ.crowns} crown${champ.crowns === 1 ? '' : 's'}`,
      score: `${champ.rating}/100`, accent: '#ffcc33', footer: '🎉 Woodside Pinball 2026 🎉',
    });
  }
  return slides;
}
