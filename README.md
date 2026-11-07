# Pinball Wizard

Local-network party leaderboard for a 40-person pinball party. Phase 0 + Phase 1 + Phase 2 are built and verified. Spec lives in [pinball-leaderboard-spec.md](pinball-leaderboard-spec.md); build framing in [claude-code-kickoff.md](claude-code-kickoff.md).

## Run

```bash
# terminal 1
cd server && npm install && npm run dev          # http://localhost:8787

# terminal 2
cd web && npm install && npm run dev             # http://localhost:5173
```

Vite proxies `/api` and `/ws` to the server, so phones on the LAN only need port `5173`.
Wipe the DB anytime with `rm server/data.db*` — schema + seed re-create on boot.

## What's in

**Player (phone)** — `/register` → balanced-random team reveal → `/` machine picker → `/machine/:id` (photo → AI-stub → Confirm/Edit/Pick or full manual number-pad) → `/machine/:id/guide` → `/about` (About-Pinball primer). All views are mobile-first (375px tested).

**TV wall** — `/tv` shows live 8-team leaderboard, rotating machine spotlight with high score + champion, live ticker, and a real-QR join card. Party-closed banner overlays when the host closes the party. Triggers into a full-screen reveal sequence (champion team → 6 machine champions → funny awards) on host command.

**Host** — `/host` (gated by `config.party.hostToken`). Open/close party, void/restore any score, draw "00–90" digits for The Match, trigger and end the reveal. `/host/qr` is a print-ready sheet of per-machine QRs deep-linking to `/machine/:id`.

## Auto-computed awards

- **Big Whiff** — lowest single non-voided score
- **Grinder** — most plays logged
- **Globetrotters** — played all six machines
- **Heartbreakers** — finished 2nd on a machine (one per machine)
- **Beginner's Luck** — top score among self-declared first-timers
- **The Match** — host draws 00–90; closest score by last two digits wins

## Layout

```
config.json                 # teams, machines, points table, AI endpoint, host token ← edit me
content/                    # markdown game guides + About Pinball (parallel workstream)
server/
  src/index.js              # Express + WebSocket + REST + host endpoints
  src/db.js                 # node:sqlite schema + idempotent seed from config
  src/standings.js          # live placement + participation points
  src/awards.js             # auto-computed funny awards
  src/ai.js                 # OpenAI-compatible client + stub
web/
  src/routes/Register.jsx   # nickname + emoji + first-timer; team reveal
  src/routes/Home.jsx       # machine picker
  src/routes/Machine.jsx    # photo / pick-from-multiple / manual / confirm
  src/routes/Guide.jsx      # per-machine markdown guide
  src/routes/About.jsx      # About Pinball
  src/routes/TV.jsx         # leaderboard + spotlight + ticker + QR join
  src/routes/Host.jsx       # host control panel
  src/routes/HostQR.jsx     # printable QR sheet
  src/components/Reveal.jsx # winner-reveal slideshow
  src/components/QR.jsx     # canvas QR
```

## Stack choices (why)

- **`node:sqlite`** built into Node 25 — no native compile, no Xcode CLT dependency.
- **Plain JS, no TS build** — fast iteration; lean stack per kickoff.
- **WebSocket broadcast** of full standings on every change — host voids correct instantly per spec §11.
- **AI stub by default** (`config.ai.stub: true`) so the loop works without LM Studio/Ollama running. Flip to `false` once Gemma is up.
- **Mobile-first CSS** — player views target ~375px; the only view that's desktop-class is `/tv`.

## Hard constraints honored

- AI reads **never** auto-commit; UI always shows Confirm/Edit with multi-score picker for multiplayer displays and a manual fallback for low confidence.
- Manual entry is a first-class peer of photo entry on every machine page.
- Balanced random team assignment: each new signup joins the smallest team (random tiebreak).
- Standings computed live, never stored — host voids correct everywhere instantly.
- All guide content is local markdown — no runtime scraping.

## Wiring real Gemma

In `config.json`:
```json
"ai": {
  "endpoint": "http://localhost:1234/v1/chat/completions",
  "model": "gemma-3-27b-it",
  "fallbackModel": "gemma-3-12b-it",
  "stub": false
}
```
LM Studio's OpenAI-compatible server defaults to that URL. The prompt in `server/src/ai.js` requests JSON-only output and soft-fails to manual entry if the model errors.
