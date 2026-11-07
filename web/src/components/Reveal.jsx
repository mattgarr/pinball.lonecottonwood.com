import { useEffect, useState } from 'react';
import Avatar from './Avatar.jsx';
import Confetti from './Confetti.jsx';
import { CountUp } from '../lib/useCountUp.js';

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
  if (!slide) return <div className="reveal-tv"><div className="reveal-empty">No data to reveal yet.</div></div>;

  return (
    <div className="reveal-tv" style={{ background: slide.bg || undefined }}>
      {slide.confetti && <Confetti key={idx} count={120} seed={idx} />}
      <div className="reveal-stage" key={idx}>
        <div className="reveal-pill">{slide.label}</div>
        {slide.trophy && <div className="reveal-trophy">🏆</div>}
        {slide.hero && (
          <div className="reveal-hero">
            <Avatar avatar={slide.hero.avatar} emoji={slide.hero.emoji} name={slide.hero.name} color={slide.hero.color} size={150} ring />
          </div>
        )}
        {slide.list ? (
          <ul className="reveal-list">{slide.list.map((item, k) => <li key={k}>{item}</li>)}</ul>
        ) : (
          <div className="reveal-headline">{slide.title}</div>
        )}
        {slide.subtitle && <div className="reveal-subtitle">{slide.subtitle}</div>}
        {slide.score != null && slide.score !== '' && (
          <div className="reveal-score">
            {slide.scoreCount ? <CountUp value={slide.score} ms={1200} format={fmt} /> : slide.score}
          </div>
        )}
        {slide.footer && <div className="reveal-footer">{slide.footer}</div>}
      </div>
      <div className="reveal-progress">
        {slides.map((_, i) => <span key={i} className={`reveal-dot${i === idx ? ' on' : ''}`} />)}
      </div>
    </div>
  );
}

const hero = p => p && { avatar: p.avatar, emoji: p.emoji, name: p.display_name, color: p.color };

function buildSlides({ standings, awards }) {
  const slides = [];

  if (awards?.beginnersLuck) {
    const b = awards.beginnersLuck;
    slides.push({
      label: "BEGINNER'S LUCK", confetti: true, hero: hero(b.player), title: b.player.display_name,
      subtitle: `${b.machine.name} · ${b.pct}% of the top score`, score: b.value, scoreCount: true,
      bg: '#4d4014', footer: 'first-timer with the goods ✨',
    });
  }
  if (awards?.grinder) {
    const g = awards.grinder;
    slides.push({
      label: 'THE GRINDER', confetti: true, hero: hero(g.player), title: g.player.display_name,
      subtitle: `${g.plays} games logged`, bg: '#1f2f4d', footer: 'absolutely sent it 💪',
    });
  }
  if (awards?.globetrotters?.length) {
    slides.push({
      label: 'GLOBETROTTERS', confetti: true,
      list: awards.globetrotters.map(p => `${p.emoji} ${p.display_name}`),
      subtitle: 'Played all six machines', bg: '#1f3d2c', footer: '🌍',
    });
  }
  if (awards?.heartbreakers?.length) {
    slides.push({
      label: 'HEARTBREAKERS', confetti: false,
      list: awards.heartbreakers.map(h => `${h.player.emoji} ${h.player.display_name} · ${h.machine.name}`),
      subtitle: 'So close: 2nd place on a machine', bg: '#43224d', footer: '💔',
    });
  }
  if (awards?.bigWhiff) {
    const w = awards.bigWhiff;
    slides.push({
      label: 'THE BIG WHIFF', confetti: false, hero: hero(w.player), title: w.player.display_name,
      subtitle: w.worst
        ? `${w.machinesPlayed} machines played · lowlight: ${ordinal(w.worst.rank)} of ${w.worst.N} on ${w.worst.machineName}`
        : `${w.machinesPlayed} machines played`,
      score: `${w.rating}/100`, bg: '#3a1d1d', footer: 'a humble effort, bravely made 🤝',
    });
  }
  if (awards?.theMatch) {
    const t = awards.theMatch;
    slides.push({
      label: 'THE MATCH', confetti: true, hero: hero(t.player), title: t.player.display_name,
      subtitle: `Drawn: ${String(t.drawn).padStart(2, '0')} · on ${t.machine.name}`,
      score: t.value, scoreCount: true, bg: '#1d2d2d', footer: 'the classic free-game raffle 🎰',
    });
  }

  for (const m of standings?.machines ?? []) {
    const c = m.champion;
    if (!c) continue;
    slides.push({
      label: `${m.machine.name.toUpperCase()} CHAMPION`, confetti: true, hero: hero(c.player),
      title: c.player.display_name, subtitle: `${m.machine.manufacturer} · ${m.machine.year}`,
      score: c.score, scoreCount: true, footer: '👑',
    });
  }

  const champ = awards?.champion;
  if (champ) {
    slides.push({
      label: 'PINBALL WIZARD 2026', trophy: true, confetti: true, hero: hero(champ.player),
      title: champ.player.display_name,
      subtitle: `Overall champion · ${champ.machinesPlayed} machines · ${champ.crowns} crown${champ.crowns === 1 ? '' : 's'}`,
      score: `${champ.rating}/100`, bg: champ.player.color, footer: '🎉 the wizard 🎉',
    });
  }

  return slides;
}
