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
const SLIDE_MS = 6500;
const ordinal = n => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

// Auto-advancing reveal: fun prizes, then machine champions, then the overall champion last.
export default function Reveal({ standings, awards }) {
  const slides = buildSlides({ standings, awards });
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % slides.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [slides.length]);

  const slide = slides[idx] ?? slides[0];
  if (!slide) return <div className="reveal-tv rv"><div className="rv-empty">No data to reveal yet.</div></div>;

  const accent = slide.accent || '#ffcc33';
  const split = !!slide.machine;

  return (
    <div className="reveal-tv rv" style={{ '--accent': accent, '--slide-ms': `${SLIDE_MS}ms` }}>
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

      <div className="rv-dots">
        {slides.map((_, i) => <span key={i === idx ? `on${idx}` : i} className={`rv-dot${i === idx ? ' on' : i < idx ? ' done' : ''}`} />)}
      </div>
    </div>
  );
}

function Ramp({ value }) {
  return fmt(useRamp(0, Number(value) || 0, 1600, 450));
}

const hero = p => p && { avatar: p.avatar, emoji: p.emoji, name: p.display_name, color: p.color };

function buildSlides({ standings, awards }) {
  const slides = [];

  if (awards?.beginnersLuck) {
    const b = awards.beginnersLuck;
    slides.push({
      label: "BEGINNER'S LUCK", confetti: true, hero: hero(b.player), title: b.player.display_name,
      subtitle: `${b.machine.name} · ${b.pct}% of the top score`, score: b.value, scoreCount: true,
      accent: '#ffcc33', footer: 'first-timer with the goods ✨',
    });
  }
  if (awards?.grinder) {
    const g = awards.grinder;
    slides.push({
      label: 'THE GRINDER', confetti: true, hero: hero(g.player), title: g.player.display_name,
      subtitle: `${g.plays} games logged`, accent: '#4d8bff', footer: 'absolutely sent it 💪',
    });
  }
  if (awards?.globetrotters?.length) {
    slides.push({
      label: 'GLOBETROTTERS', confetti: true,
      list: awards.globetrotters.map(p => ({ player: p })),
      subtitle: 'Played all six machines', accent: '#2ee6a0', footer: '🌍',
    });
  }
  if (awards?.heartbreakers?.length) {
    slides.push({
      label: 'HEARTBREAKERS', confetti: false,
      list: awards.heartbreakers.map(h => ({ player: h.player, note: h.machine.name })),
      subtitle: 'So close: 2nd place on a machine', accent: '#ff4fa0', footer: '💔',
    });
  }
  if (awards?.bigWhiff) {
    const w = awards.bigWhiff;
    slides.push({
      label: 'THE BIG WHIFF', confetti: false, hero: hero(w.player), title: w.player.display_name,
      subtitle: w.worst
        ? `${w.machinesPlayed} machines played · lowlight: ${ordinal(w.worst.rank)} of ${w.worst.N} on ${w.worst.machineName}`
        : `${w.machinesPlayed} machines played`,
      score: `${w.rating}/100`, accent: '#ff5b5b', footer: 'a humble effort, bravely made 🤝',
    });
  }
  if (awards?.theMatch) {
    const t = awards.theMatch;
    slides.push({
      label: 'THE MATCH', confetti: true, hero: hero(t.player), title: t.player.display_name,
      subtitle: `Drawn: ${String(t.drawn).padStart(2, '0')} · on ${t.machine.name}`,
      score: t.value, scoreCount: true, accent: '#29d4d4', footer: 'the classic free-game raffle 🎰',
    });
  }

  for (const m of standings?.machines ?? []) {
    const c = m.champion;
    if (!c) continue;
    slides.push({
      label: `${m.machine.name.toUpperCase()} CHAMPION`, confetti: true, hero: hero(c.player), machine: m.machine,
      title: c.player.display_name, subtitle: `${m.machine.manufacturer} · ${m.machine.year}`,
      score: c.score, scoreCount: true, accent: machineGlow(m.machine.name), footer: '👑',
    });
  }

  const champ = awards?.champion;
  if (champ) {
    slides.push({
      label: 'PINBALL WIZARD 2026', trophy: true, confetti: true, rays: true, hero: hero(champ.player),
      title: champ.player.display_name,
      subtitle: `Overall champion · ${champ.machinesPlayed} machines · ${champ.crowns} crown${champ.crowns === 1 ? '' : 's'}`,
      score: `${champ.rating}/100`, accent: '#ffcc33', footer: '🎉 the wizard 🎉',
    });
  }

  return slides;
}
