# Claude Code Kickoff — Pinball Party Leaderboard

Paste this into Claude Code at the start of the session. Put `pinball-leaderboard-spec.md` in the repo root first — it's the source of truth; this brief is just the framing and build order.

---

## What we're building

A local-network web app for a 40-person pinball party. Players register on their phones (random team assignment), log scores on six machines by photographing the score display (a **local** AI reads it) or entering manually, and a shared TV shows live team standings. Each machine also has a guide; there's an intro-to-pinball page. Read `pinball-leaderboard-spec.md` in full before writing code.

## Architecture — read this first, it shapes everything

**One laptop (M5 Max MacBook, 128 GB) is the entire party server.** It runs the app, the database + realtime, and the AI model. All ~40 phones and the TV connect to it over local WiFi. **No cloud.** Build for **fully offline operation** — the venue WiFi may have no internet, and that's fine.

- **Frontend:** React. Routes: `/tv` (full-screen overlay, HDMI to the TV), `/` (player), `/host`, `/machine/:id` (deep-link target for the per-machine QR codes).
- **Data + realtime:** Postgres or SQLite + a small Node/Bun server with **WebSocket** broadcast for live updates. Keep it lightweight; ~40 concurrent users.
- **AI score reads:** call a **local** OpenAI-compatible endpoint (LM Studio or Ollama) running **Gemma 3 multimodal** — default **27B**, with **12B** as a config-swappable fallback. Send the photo as base64, prompt for **JSON only**: `{"scores": [<ints>], "confidence": "high|low"}`. No cloud API, no secret keys anywhere in the codebase.
- **Identity:** anonymous session token in `localStorage`. No auth library.
- Make the model endpoint URL, the points table, and the team list **config**, not hardcoded.

## Hard constraints to honor from line one

1. **Never auto-commit an AI read.** Always show "We got [score] — Confirm / Edit." Multiple numbers detected → let the player pick theirs. Low/no confidence → drop to manual number-pad entry.
2. **Manual entry is a first-class path**, not a hidden fallback. Every score-entry screen offers it.
3. **No runtime web scraping.** Game-guide and About-Pinball content is local static content (markdown/JSON), supplied separately. Render it; don't fetch it.
4. **Random team assignment = balanced**, not pure random: each new registrant joins the *smallest current team* (random tiebreak), so teams stay even regardless of arrival order or final headcount.
5. **Standings computed live** from scores (best per team×machine → placement points + participation points), pushed over WebSocket. Don't store standings; recompute so a host void instantly corrects the board.

## Build order

**Phase 0 — prove the loop (do this before anything else).**
Stand up the server + DB + a stubbed AI endpoint, then get **one score round-tripping end to end**:
register → pick a machine → photo → AI read (stub returns a number first, then wire real Gemma) → confirm → score lands in DB → appears on the `/tv` overlay live.
Don't build teams math, prizes, guides, or animations until this works.

**Phase 1 — the real game (P0 in the spec).**
Random team assignment + reveal · team standings with placement + participation points · per-machine champion crowns · host view (open/close, void/edit) · the live TV overlay (team board + machine spotlights).

**Phase 2 — polish & extras (P1 in the spec).**
Per-machine QR deep links · game-guide + About-Pinball pages (render supplied content) · activity ticker · winner-reveal sequence · auto-computed funny awards (Big Whiff, Grinder, Globetrotter, Heartbreaker, Beginner's Luck, The Match) · multiplayer score picker.

## Day-of operational notes to design around

- Laptop needs a **stable LAN IP or `.local` hostname**; phones reach the app there. Print the machine QRs as links to `http://<that-host>/machine/:id`.
- Confirm the party **WiFi allows client-to-client traffic** (some consumer routers block it). Provide a fallback (e.g., the laptop hosting its own hotspot) if it doesn't.
- Keep the laptop **awake** for the whole party.

## Do-first, outside the code

Before relying on photo entry, **test Gemma reads on each of the six machines' displays** (Centaur and Fathom are early-'80s 7-segment and the riskiest; White Water/Cactus Canyon are dot-matrix; the Stern is modern). Pick the smallest model that reads all six reliably, and tune the extraction prompt per display type if needed.

## Parallel workstream (not Claude Code's job)

The six game guides + the About-Pinball intro are **content**, written separately as original summaries from research and dropped in as local markdown/JSON. The app just needs to render them.
