import express from 'express';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { config } from './config.js';
import { computeStandings } from './standings.js';
import { computeAwards } from './awards.js';
import { extractScore } from './ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(__dirname, '../../content');

const PORT = Number(process.env.PORT ?? 8787);

const app = express();
app.use(express.json({ limit: '20mb' })); // photos as base64

// ---- runtime state -------------------------------------------------------
// Reveal mode is in-memory; survives across HMR-equivalent restarts? no — that's fine,
// the host can re-trigger it. matchDigits is the "00..90" draw for The Match.
let revealState = { active: false, matchDigits: null };

// Rank-movement snapshot: teamId -> rank, refreshed on an interval so the TV can show
// who's climbing / sliding "since a moment ago". Delta = prevRank - currentRank (+ = up).
let rankSnapshot = new Map();
const RANK_WINDOW_MS = 150_000;

function standings() {
  const s = computeStandings();
  return {
    ...s,
    teams: s.teams.map(t => {
      const prev = rankSnapshot.has(t.teamId) ? rankSnapshot.get(t.teamId) : t.rank;
      return { ...t, prevRank: prev, delta: prev - t.rank };
    }),
  };
}
function refreshRankSnapshot() {
  const s = computeStandings();
  rankSnapshot = new Map(s.teams.map(t => [t.teamId, t.rank]));
}
refreshRankSnapshot();
setInterval(refreshRankSnapshot, RANK_WINDOW_MS);

// ---- helpers --------------------------------------------------------------
function newToken() {
  return randomBytes(16).toString('hex');
}

function playerFromToken(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT p.id, p.display_name, p.emoji, p.avatar, p.team_id, p.first_timer, p.session_token,
           t.name AS team_name, t.color AS team_color
    FROM players p JOIN teams t ON t.id = p.team_id
    WHERE p.session_token = ?
  `).get(token) ?? null;
}

function isHost(req) {
  return req.get('x-host-token') === config.party.hostToken;
}

function assignSmallestTeam() {
  const rows = db.prepare(`
    SELECT t.id, COUNT(p.id) AS n
    FROM teams t LEFT JOIN players p ON p.team_id = t.id
    GROUP BY t.id ORDER BY n ASC, t.id
  `).all();
  if (!rows.length) throw new Error('no teams configured');
  const min = rows[0].n;
  const candidates = rows.filter(r => r.n === min);
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

function partyStatus() {
  const row = db.prepare('SELECT name, status FROM party WHERE id = 1').get();
  return row;
}

// ---- WebSocket broadcast --------------------------------------------------
const wss = new WebSocketServer({ noServer: true });
const sockets = new Set();
wss.on('connection', ws => {
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
  try {
    ws.send(JSON.stringify({ type: 'standings', standings: standings() }));
    ws.send(JSON.stringify({ type: 'party', party: partyStatus() }));
    if (revealState.active) {
      ws.send(JSON.stringify({
        type: 'reveal',
        active: true,
        standings: computeStandings(),
        awards: computeAwards({ matchDigits: revealState.matchDigits }),
      }));
    }
  } catch {}
});
function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === 1) ws.send(payload);
}
function broadcastStandings() {
  broadcast({ type: 'standings', standings: standings() });
}

// ---- REST -----------------------------------------------------------------
app.get('/api/config', (_req, res) => {
  res.json({
    party: { name: config.party.name },
    teams: db.prepare('SELECT id, name, color FROM teams ORDER BY id').all(),
    machines: db.prepare('SELECT id, name, year, manufacturer, display_type AS displayType FROM machines WHERE active = 1 ORDER BY sort_order, id').all(),
    status: partyStatus().status,
  });
});

app.get('/api/me', (req, res) => {
  const token = req.get('x-session-token');
  const player = playerFromToken(token);
  res.json({ player });
});

app.post('/api/register', (req, res) => {
  if (partyStatus().status !== 'open') return res.status(403).json({ error: 'party is closed' });
  const { displayName, emoji, firstTimer, avatar } = req.body ?? {};
  const name = String(displayName ?? '').trim().slice(0, 32);
  if (!name) return res.status(400).json({ error: 'displayName required' });
  const e = String(emoji ?? '🎯').slice(0, 8) || '🎯';
  // Accept a small data-URL selfie; reject anything that isn't a reasonable inline image.
  let av = null;
  if (typeof avatar === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(avatar) && avatar.length < 400_000) {
    av = avatar;
  }
  const ft = firstTimer ? 1 : 0;
  const token = newToken();
  const teamId = assignSmallestTeam();
  const info = db.prepare(`
    INSERT INTO players (display_name, emoji, avatar, team_id, first_timer, session_token)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, e, av, teamId, ft, token);
  const player = db.prepare(`
    SELECT p.id, p.display_name, p.emoji, p.avatar, p.team_id, p.first_timer, p.session_token,
           t.name AS team_name, t.color AS team_color
    FROM players p JOIN teams t ON t.id = p.team_id WHERE p.id = ?
  `).get(info.lastInsertRowid);
  broadcastStandings();
  broadcast({ type: 'player_joined', player: { displayName: player.display_name, emoji: player.emoji, avatar: player.avatar, teamName: player.team_name, teamColor: player.team_color } });
  res.json({ player });
});

app.get('/api/machines/:id', (req, res) => {
  const id = Number(req.params.id);
  const m = db.prepare(`
    SELECT id, name, year, manufacturer, display_type AS displayType
    FROM machines WHERE id = ?
  `).get(id);
  if (!m) return res.status(404).json({ error: 'machine not found' });
  const topScores = db.prepare(`
    SELECT s.value, p.display_name, p.emoji, p.avatar, t.name AS team_name, t.color AS team_color, s.created_at
    FROM scores s
    JOIN players p ON p.id = s.player_id
    JOIN teams t ON t.id = p.team_id
    WHERE s.machine_id = ? AND s.voided = 0
    ORDER BY s.value DESC LIMIT 10
  `).all(id);
  res.json({ machine: m, topScores });
});

app.post('/api/ai/read', async (req, res) => {
  const { imageBase64, machineId } = req.body ?? {};
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });
  const machine = machineId
    ? db.prepare('SELECT name, display_type FROM machines WHERE id = ?').get(Number(machineId))
    : null;
  try {
    const result = await extractScore({
      imageBase64,
      machineHint: machine ? `${machine.name} (${machine.display_type})` : null,
    });
    res.json(result);
  } catch (err) {
    console.error('[ai/read]', err);
    res.json({ scores: [], confidence: 'low', error: String(err.message ?? err) });
  }
});

app.post('/api/scores', (req, res) => {
  if (partyStatus().status !== 'open') return res.status(403).json({ error: 'party is closed' });
  const token = req.get('x-session-token');
  const player = playerFromToken(token);
  if (!player) return res.status(401).json({ error: 'unauthenticated' });
  const { machineId, value, aiExtracted } = req.body ?? {};
  const mId = Number(machineId);
  const v = Math.trunc(Number(value));
  if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid score' });
  const m = db.prepare('SELECT id, name FROM machines WHERE id = ? AND active = 1').get(mId);
  if (!m) return res.status(400).json({ error: 'unknown machine' });

  const info = db.prepare(`
    INSERT INTO scores (player_id, machine_id, value, ai_extracted)
    VALUES (?, ?, ?, ?)
  `).run(player.id, mId, v, aiExtracted ? 1 : 0);

  broadcastStandings();
  broadcast({
    type: 'score',
    score: {
      id: info.lastInsertRowid,
      value: v,
      machineId: mId,
      machineName: m.name,
      playerName: player.display_name,
      emoji: player.emoji,
      avatar: player.avatar,
      teamName: player.team_name,
      teamColor: player.team_color,
    },
  });
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.get('/api/standings', (_req, res) => res.json(standings()));
app.get('/api/awards', (req, res) => {
  const md = req.query.matchDigits;
  res.json(computeAwards({ matchDigits: md == null ? null : Number(md) }));
});

// ---- content (markdown game guides + About Pinball) ----------------------
function readContent(slug) {
  // slug is constrained to a..z0-9-_ — defends against path traversal.
  if (!/^[a-z0-9_-]+$/i.test(slug)) return null;
  const p = resolve(CONTENT_DIR, `${slug}.md`);
  if (!p.startsWith(CONTENT_DIR + '/') && p !== CONTENT_DIR) return null;
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

app.get('/api/content/about', (_req, res) => {
  const md = readContent('about-pinball');
  if (md == null) return res.status(404).json({ error: 'missing' });
  res.json({ markdown: md });
});

app.get('/api/content/machine/:id', (req, res) => {
  const id = Number(req.params.id);
  const m = db.prepare('SELECT id, name FROM machines WHERE id = ?').get(id);
  if (!m) return res.status(404).json({ error: 'machine not found' });
  // Slug = lowercased, alphanumerics-only with hyphens
  const slug = m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const md = readContent(`machine-${slug}`);
  if (md == null) return res.status(404).json({ error: 'missing', expectedFile: `content/machine-${slug}.md` });
  res.json({ markdown: md, machine: m });
});

// ---- host ---------------------------------------------------------------
function requireHost(req, res, next) {
  if (!isHost(req)) return res.status(401).json({ error: 'host token required' });
  next();
}

app.post('/api/host/login', (req, res) => {
  const { token } = req.body ?? {};
  res.json({ ok: token === config.party.hostToken });
});

app.post('/api/host/party/:status', requireHost, (req, res) => {
  const status = req.params.status;
  if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'bad status' });
  db.prepare('UPDATE party SET status = ? WHERE id = 1').run(status);
  broadcast({ type: 'party', party: partyStatus() });
  res.json({ ok: true });
});

app.get('/api/host/scores', requireHost, (_req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.value, s.voided, s.ai_extracted AS aiExtracted, s.created_at AS createdAt,
           m.name AS machineName, p.display_name AS playerName, p.emoji,
           t.name AS teamName, t.color AS teamColor
    FROM scores s
    JOIN players p ON p.id = s.player_id
    JOIN machines m ON m.id = s.machine_id
    JOIN teams t ON t.id = p.team_id
    ORDER BY s.created_at DESC
    LIMIT 200
  `).all();
  res.json({ scores: rows });
});

app.post('/api/host/scores/:id/void', requireHost, (req, res) => {
  db.prepare('UPDATE scores SET voided = 1 WHERE id = ?').run(Number(req.params.id));
  broadcastStandings();
  res.json({ ok: true });
});

app.post('/api/host/scores/:id/restore', requireHost, (req, res) => {
  db.prepare('UPDATE scores SET voided = 0 WHERE id = ?').run(Number(req.params.id));
  broadcastStandings();
  res.json({ ok: true });
});

app.post('/api/host/reveal', requireHost, (req, res) => {
  const { active, matchDigits } = req.body ?? {};
  revealState = {
    active: !!active,
    matchDigits: matchDigits == null || matchDigits === '' ? null : Number(matchDigits),
  };
  if (revealState.active) {
    broadcast({
      type: 'reveal',
      active: true,
      standings: computeStandings(),
      awards: computeAwards({ matchDigits: revealState.matchDigits }),
    });
  } else {
    broadcast({ type: 'reveal', active: false });
  }
  res.json({ ok: true, reveal: revealState });
});

app.get('/api/healthz', (_req, res) => res.json({ ok: true }));

// ---- start ----------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`[pinball] http://localhost:${PORT}  (WS at /ws)`);
  console.log(`[pinball] AI stub = ${config.ai.stub}, endpoint = ${config.ai.endpoint}`);
});
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});
