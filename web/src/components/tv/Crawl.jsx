import { useMemo } from 'react';
import { fmtShort } from '../../lib/scoring.js';


// News-channel crawl along the bottom. Fresh events lead as BREAKING; standing headlines fill the rest.
export default function Crawl({ standings, awards, news, machines }) {
  const items = useMemo(() => {
    const out = [];
    const fresh = news.slice(0, 4).map(n => ({ k: n.id, tag: 'BREAKING', text: n.text, hot: true }));
    const lead = standings.topPlayers[0];
    if (lead) out.push({ tag: 'LEADER', text: `${lead.player.display_name} · ${lead.rating}` });
    for (const m of standings.machines) {
      out.push(m.champion
        ? { tag: m.machine.name, text: `${m.champion.player.display_name} · ${fmtShort(m.champion.score)}` }
        : { tag: m.machine.name, text: 'up for grabs' });
    }
    if (awards.grinder) out.push({ tag: 'GRINDER', text: `${awards.grinder.player.display_name} · ${awards.grinder.plays} games` });
    out.push({ tag: 'TONIGHT', text: `${standings.meta.totalPlayers} players · ${standings.meta.totalScores} games` });
    out.push({ tag: 'SCAN TO PLAY', text: 'scan · snap · climb' });
    return [...fresh, ...out.map((x, i) => ({ ...x, k: `s${i}` }))];
  }, [standings, awards, news, machines]);

  // Speed is constant per character, so long crawls don't race.
  const chars = items.reduce((n, it) => n + it.tag.length + it.text.length + 6, 0);
  // Bigger text (22px) at about 25% faster on-screen speed than the old 16px crawl.
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
