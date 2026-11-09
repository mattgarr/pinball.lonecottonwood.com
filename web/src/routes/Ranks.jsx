import { Link, useSearchParams } from 'react-router-dom';
import { useAllTime, useAwards, useStandings } from '../lib/store.js';
import { MIN_TABLES, fmt, ordinal } from '../lib/scoring.js';
import Avatar from '../components/Avatar.jsx';
import PixelEmoji from '../components/PixelEmoji.jsx';

// Leaderboard: OVERALL (rating) or one machine (best scores). My row is always highlighted,
// and a "YOU" bar up top says where I stand without scrolling.
export default function Ranks() {
  const [params, setParams] = useSearchParams();
  const { events, allMachines, party, me, players } = useStandings();
  const multiEvent = (events?.length ?? 0) > 1;
  const ever = multiEvent && params.get('t') === 'all';
  const pickedEvId = multiEvent && !ever && params.get('event') ? Number(params.get('event')) : party?.current_event_id;
  const { machines: eventMachines, standings: eventStandings, event: pickedEvent } = useStandings(pickedEvId);
  const allTime = useAllTime();
  const awards = useAwards(eventStandings, null);
  const view = params.get('m') || 'all';
  const scopeParams = ever ? { t: 'all' } : (pickedEvId && pickedEvId !== party?.current_event_id ? { event: String(pickedEvId) } : {});
  const setView = v => setParams({ ...scopeParams, ...(v === 'all' ? {} : { m: v }) }, { replace: true });
  const setScope = next => setParams({ ...next, ...(view === 'all' ? {} : { m: view }) }, { replace: true });
  const standings = ever ? allTime : eventStandings;
  const machines = ever ? allMachines : eventMachines;
  const mine = me ? standings.stats.get(me.id) : null;
  const machineEntry = standings.machines.find(x => String(x.machine.id) === view);

  return (
    <div className="screen ranks">
      <h1>Ranks</h1>
      {multiEvent && (
        <div className="rk-scope" role="tablist" aria-label="Tournament">
          {events.map(e => {
            const on = !ever && e.id === pickedEvId;
            return (
              <button
                key={e.id}
                role="tab"
                aria-selected={on}
                className={on ? 'on' : ''}
                onClick={() => setScope(e.id === party?.current_event_id ? {} : { event: String(e.id) })}
              >
                {e.name}{e.id === party?.current_event_id ? ' ★' : ''}
              </button>
            );
          })}
          <button role="tab" aria-selected={ever} className={ever ? 'on' : ''} onClick={() => setScope({ t: 'all' })}>All-time</button>
        </div>
      )}

      <div className="rk-tabs" role="tablist">
        <button role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>Overall</button>
        {machines.map(m => (
          <button key={m.id} role="tab" aria-selected={view === String(m.id)} className={view === String(m.id) ? 'on' : ''} onClick={() => setView(String(m.id))}>
            {shortName(m.name)}
          </button>
        ))}
      </div>

      {view === 'all' ? <Overall standings={standings} mine={mine} me={me} machines={machines} awards={ever ? null : awards} closed={!ever && pickedEvent?.status === 'closed'} />
        : machineEntry ? <MachineBoard entry={machineEntry} me={me} mine={mine} players={players} />
        : <div className="muted">No such machine.</div>}
    </div>
  );
}

const shortName = n => ({
  'Dungeons & Dragons': 'D&D',
  'Cactus Canyon': 'Cactus',
  'Foo Fighters': 'Foo',
  'Medieval Madness': 'Medieval',
  'Monster Bash': 'Monster',
  'The Addams Family': 'Addams',
  'Whitewater': 'Whitewater',
}[n] || n);

function YouBar({ me, children }) {
  if (!me) return null;
  return (
    <div className="rk-you">
      <Avatar avatar={me.avatar} emoji={me.emoji} name={me.display_name} color={me.color} size={32} />
      <div className="rk-you-text">{children}</div>
    </div>
  );
}

function Overall({ standings, mine, me, machines, awards, closed }) {
  const ranked = standings.ranked;
  const unranked = [...standings.stats.values()]
    .filter(st => st.rating == null)
    .sort((a, b) => b.machinesPlayed - a.machinesPlayed || a.player.display_name.localeCompare(b.player.display_name));

  return (
    <>
      <YouBar me={me}>
        {mine?.rating != null
          ? <><b>{ordinal(mine.rank)}</b> of {ranked.length} · rating <b>{mine.rating}</b></>
          : <>Not ranked yet · <b>{Math.max(0, MIN_TABLES - (mine?.machinesPlayed || 0))} more machine{MIN_TABLES - (mine?.machinesPlayed || 0) === 1 ? '' : 's'}</b> to get ranked</>}
      </YouBar>

      {closed && <div className="note-ok">Scoring's closed. These are final.</div>}

      <section className="panel rk-board">
        <div className="rk-head"><span>#</span><span>Player</span><span>Machines</span><span>Rating</span></div>
        <ol className="rk-list">
          {ranked.map(st => (
            <li key={st.player.id} className={`${st.player.id === me?.id ? 'mine' : ''}${st.rank <= 3 ? ` p${st.rank}` : ''}`}>
              <span className="rk-rank">{st.rank === 1 ? <PixelEmoji e="👑" size={18} grid={12} /> : st.rank}</span>
              <span className="rk-who">
                <Avatar avatar={st.player.avatar} emoji={st.player.emoji} name={st.player.display_name} color={st.player.color} size={28} />
                <span className="rk-name">{st.player.display_name}{st.crowns > 0 && <span className="rk-crowns"><PixelEmoji e="👑" size={14} grid={12} />{st.crowns > 1 ? `×${st.crowns}` : ''}</span>}</span>
              </span>
              <span className="rk-tables">{st.machinesPlayed}/{machines.length}</span>
              <span className="rk-val">{st.rating}</span>
            </li>
          ))}
          {ranked.length === 0 && <li className="rk-empty">Nobody's ranked yet. Play {MIN_TABLES} machines to get on the board!</li>}
        </ol>
        <div className="muted small rk-legend">
          Rating = your average points across machines (1st = 100 pts). Play {MIN_TABLES}+ machines to rank.
        </div>
      </section>

      {unranked.length > 0 && (
        <section className="panel rk-board">
          <h3>Not ranked yet</h3>
          <div className="muted small">Machines played, out of the {MIN_TABLES} needed.</div>
          <ul className="rk-list rk-unranked">
            {unranked.map(st => (
              <li key={st.player.id} className={st.player.id === me?.id ? 'mine' : ''}>
                <span className="rk-who">
                  <Avatar avatar={st.player.avatar} emoji={st.player.emoji} name={st.player.display_name} color={st.player.color} size={24} />
                  <span className="rk-name">{st.player.display_name}</span>
                </span>
                <span className="rk-tables">{st.machinesPlayed}/{MIN_TABLES}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="muted small rk-legend">🏆 There will be prizes! Winners are announced on the TV at the end of the night.</div>
    </>
  );
}

function MachineBoard({ entry, me, mine, players }) {
  const pm = mine?.perMachine[entry.machine.id];
  const byId = new Map(players.map(p => [p.id, p]));
  return (
    <>
      <YouBar me={me}>
        {pm ? <><b>{ordinal(pm.rank)}</b> of {pm.N} · best <b>{fmt(pm.best)}</b></> : <>No score here yet</>}
      </YouBar>
      <section className="panel rk-board">
        <div className="rk-head rk-head-m"><span>#</span><span>{entry.machine.name}</span><span>Best</span></div>
        <ol className="rk-list">
          {entry.rows.map(r => {
            const p = byId.get(r.playerId) || { id: r.playerId, display_name: '?' };
            return <MachineRow key={r.playerId} r={r} player={p} me={me} />;
          })}
          {entry.rows.length === 0 && <li className="rk-empty">No scores yet. Be the first!</li>}
        </ol>
      </section>
      <Link to={`/machine/${entry.machine.id}`} className="cta cta-soft rk-play">Play {entry.machine.name}</Link>
    </>
  );
}

function MachineRow({ r, player, me }) {
  return (
    <li className={`${r.playerId === me?.id ? 'mine' : ''}${r.rank <= 3 ? ` p${r.rank}` : ''}`}>
      <span className="rk-rank">{r.rank === 1 ? <PixelEmoji e="👑" size={18} grid={12} /> : r.rank}</span>
      <span className="rk-who">
        <Avatar avatar={player.avatar} emoji={player.emoji} name={player.display_name} color={player.color} size={28} />
        <span className="rk-name">{player.display_name}</span>
      </span>
      <span className="rk-val">{fmt(r.best)}</span>
    </li>
  );
}
