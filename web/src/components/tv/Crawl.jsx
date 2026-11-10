import { useMemo } from 'react';
import { fmtShort } from '../../lib/scoring.js';
import { machineHighlights } from '../../lib/content.js';

// News-channel crawl along the bottom. Fresh events lead as BREAKING; dynamic party storylines & pro tips fill the rest.
// freePlay ('pre' before the tournament, 'free' after the awards): high scores and tips instead of
// the title race. highScores: computeHighScores rows.
export default function Crawl({ standings, awards, news, machines, freePlay = null, highScores = null, startsAt = null, sealed = false }) {
  const items = useMemo(() => {
    const out = [];
    const fresh = news.slice(0, 4).map(n => ({ k: n.id, tag: 'BREAKING', text: n.text, hot: true }));
    if (freePlay) {
      out.push(freePlay === 'pre'
        ? { tag: 'FREE PLAY', text: `Warm up now: these scores don't count. The tournament starts${startsAt ? ` at ${startsAt}` : ' soon'}!` }
        : { tag: 'FREE PLAY', text: "Just for fun: scores don't change the tournament. Results are final." });
      if (freePlay === 'free' && awards?.champion) out.push({ tag: 'GRAND CHAMPION', text: `${awards.champion.player.display_name} · ${awards.champion.rating} rating` });
      for (const h of highScores || []) {
        const top = h.top[0];
        out.push(top
          ? { tag: `HIGH SCORE · ${h.machine.name}`, text: `${top.player.display_name} · ${fmtShort(top.score)}` }
          : { tag: `OPEN TABLE · ${h.machine.name}`, text: 'No scores yet tonight: first one takes the top spot!' });
      }
      for (const m of machines) {
        const hi = machineHighlights(m.name);
        if (hi.tips[0]) out.push({ tag: `PRO TIP · ${m.name}`, text: hi.tips[0] });
      }
      out.push({ tag: 'SCAN TO PLAY', text: 'Scan the QR code · snap your score · beat the high scores' });
      return [...fresh, ...out.map((x, i) => ({ ...x, k: `s${i}` }))];
    }

    if (sealed) out.push({ tag: 'RESULTS SEALED', text: 'Who won? Find out at the awards!' });
    // 1. Overall leader & tightest top-of-board race (not while results are sealed)
    const lead = sealed ? null : standings.topPlayers[0];
    const second = standings.topPlayers[1];
    if (lead && second && lead.rating - second.rating <= 8) {
      const diff = lead.rating - second.rating;
      out.push({
        tag: 'TITLE RACE',
        text: diff === 0
          ? `${lead.player.display_name} & ${second.player.display_name} are tied for #1 at ${lead.rating} pts!`
          : `${lead.player.display_name} (${lead.rating}) leads ${second.player.display_name} (${second.rating}) by just ${diff} pt${diff === 1 ? '' : 's'}`,
      });
    } else if (lead) {
      out.push({ tag: 'LEADER', text: `${lead.player.display_name} · ${lead.rating} rating` });
    }

    // 2. Closest machine battles (#1 vs #2 within 25%)
    for (const m of standings.machines) {
      if (m.top.length >= 2 && m.top[0].score > 0) {
        const gap = m.top[0].score - m.top[1].score;
        if (gap / m.top[0].score <= 0.28) {
          out.push({
            tag: `CLOSE CALL · ${m.machine.name}`,
            text: `${m.top[0].player.display_name} leads ${m.top[1].player.display_name} by only ${fmtShort(gap)}`,
          });
        }
      }
    }

    // 3. Open / underplayed machines (< 3 players)
    const openMachines = standings.machines.filter(m => m.N < 3);
    for (const m of openMachines.slice(0, 2)) {
      out.push({
        tag: `OPEN TABLE · ${m.machine.name}`,
        text: m.N === 0 ? 'No scores yet — first score takes the crown!' : `Only ${m.N} score${m.N === 1 ? '' : 's'} logged — easy rating points!`,
      });
    }

    // 4. "1 machine away from ranking" nudge
    const oneAway = [...standings.stats.values()].filter(u => u.machinesPlayed === 1);
    if (oneAway.length > 0) {
      const names = oneAway.slice(0, 4).map(u => u.player.display_name).join(', ');
      out.push({
        tag: '1 MORE TO RANK',
        text: `${names}: play 1 more machine to unlock your overall ranking!`,
      });
    }

    // 5. Grinder & Tonight's total action
    if (awards.grinder && !sealed) {
      out.push({ tag: 'THE GRINDER', text: `${awards.grinder.player.display_name} · ${awards.grinder.plays} games played` });
    }
    out.push({ tag: 'TONIGHT', text: `${standings.meta.totalPlayers} players · ${standings.meta.totalScores} games logged` });

    // 6. Bite-sized 1-line Pro Tips from /content/machine-*.md
    for (const m of machines) {
      const hi = machineHighlights(m.name);
      if (hi.tips[0]) {
        out.push({ tag: `PRO TIP · ${m.name}`, text: hi.tips[0] });
      }
    }

    out.push({ tag: 'SCAN TO PLAY', text: 'Scan the QR code · snap your score · climb the board' });
    return [...fresh, ...out.map((x, i) => ({ ...x, k: `s${i}` }))];
  }, [standings, awards, news, machines, freePlay, highScores, startsAt, sealed]);

  // Speed is constant per character, so long crawls don't race.
  const chars = items.reduce((n, it) => n + it.tag.length + it.text.length + 6, 0);
  const dur = Math.max(44, Math.round(chars * 0.24));
  const row = items.map(it => (
    <span key={it.k} className={`crawl-item${it.hot ? ' hot' : ''}`}>
      <b>{it.tag}</b>{it.text}<i>◆</i>
    </span>
  ));

  return (
    <div className="crawl">
      <div className="crawl-tag"><span className="crawl-dot" />NEWS</div>
      <div className="crawl-track">
        <div className="crawl-move" key={news[0]?.id || 'base'} style={{ animationDuration: `${dur}s` }}>
          <span className="crawl-run">{row}</span>
          <span className="crawl-run" aria-hidden="true">{row}</span>
        </div>
      </div>
    </div>
  );
}
