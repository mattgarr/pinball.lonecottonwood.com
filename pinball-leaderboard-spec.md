# Pinball Party Leaderboard — Design Spec (v3)

**One-liner:** A live, team-based leaderboard for a 40-person pinball party, served entirely from a laptop on local WiFi. Players snap a photo of their score and a local AI logs it; a shared TV overlay shows standings in real time. Each machine also has a built-in guide, plus an intro to pinball itself.

---

## 1. Locked decisions

| # | Decision | Detail |
|---|----------|--------|
| 1 | **Connect** | Mobile web app via **QR code** — zero install. |
| 2 | **Identity** | Lightweight registration: nickname + emoji + "first-timer?" flag. Team assigned **randomly** at signup. No login. |
| 3 | **Format** | **Teams** for the overall; **individuals** for per-machine crowns + funny awards. |
| 4 | **Score entry** | Pick/scan a machine → **photo → local AI reads it → confirm** → logged. **Manual entry** always available. |
| 5 | **Inference** | **Local** — Gemma 3 multimodal on the MacBook. No cloud, no API key, works offline. |
| 6 | **Display** | Always-live **TV overlay**: team leaderboard, machine spotlights, activity ticker, winner reveal. |
| 7 | **Game guides** | Per-machine info (history, theme, how to play, scoring tips) + an "About pinball" intro. |

**Event parameters:** ~40 people · 6 machines · ~2 hours · mostly inexperienced players.

---

## 2. Throughput reality (why the format works)

6 machines × 120 min ÷ 40 people ≈ **18 min each** → realistically **4–5 plays per person**. Coverage of all six machines is comfortable, so teams aren't rescuing the math — they exist to (a) keep the TV readable (8 rootable rows, not 40 invisible ones) and (b) absorb a nervous beginner's rough game into a team total instead of stranding them at the bottom.

## 3. Machines

Centaur · Fathom · Whirlwind · White Water · Cactus Canyon · Dungeons & Dragons (Stern)

These span 7-segment LED (Centaur, Fathom), alphanumeric segment (Whirlwind), dot-matrix (White Water, Cactus Canyon), and modern Stern displays — which is exactly why score entry needs an AI-read + confirm step rather than blind auto-commit.

---

## 4. Score entry (core feature)

**Getting to a machine — two paths:**
- **Scan the QR taped to the machine** → deep-links straight to that machine's screen. (Optional but nice; cuts a step and removes "which machine was I on?" errors.)
- **Pick it from the list** in the app.

**Then:** take a photo of the score display → **local Gemma multimodal reads it** → **"We got [score] — Confirm / Edit"** → logged. If the model returns more than one number (multiplayer display), the player taps which is theirs. **Manual number-pad entry** is always offered instead of the photo.

**Technical approach:**
- Inference runs **locally on the MacBook (M5 Max, 128 GB)** — no cloud, no API key, works even if the venue WiFi has no internet.
- The laptop runs **Gemma 3 multimodal** behind an OpenAI-compatible endpoint (LM Studio or Ollama). Recommend **Gemma 3 27B** for read accuracy on harder displays — plenty of headroom on 128 GB — with **12B** as a faster fallback.
- Client captures photo → sends image (base64) over the LAN to the laptop's `/v1/chat/completions` with a JSON-only prompt.
- Prompt returns **JSON only**: every distinct score-like number detected, e.g. `{"scores": [12400000, 8230110], "confidence": "high"}`.
- Parse → one score pre-fills confirm; several → picker; none/low confidence → manual entry.
- On confirm, write to `scores` with `ai_extracted = true` (photo can be discarded after the read).

**Why confirm, not auto-commit:** glare, angle, and old segmented digits make blind reads risky — and a local model will miss more of those than a frontier one, so the confirm step matters *more* here. Photograph each machine's display ahead of time to sanity-check reads (the '81 Centaur/Fathom 7-segment displays are the likeliest to trip it up) and tune the prompt if needed.

## 5. Game guides & About Pinball

Each machine has an info screen, reachable from its machine page (or by scanning its QR). Per machine:
- **What it is** — manufacturer, year, theme in a sentence or two.
- **How to play** — the main shots, modes, and what to aim for.
- **Scoring tips** — how to actually rack up points (great for the beginner crowd).
- **A bit of history / trivia** — why the machine is notable.

Plus a standalone **About Pinball** screen: flippers, multiball, nudging and tilt, how scoring generally works, and basic etiquette — enough that a total first-timer isn't lost.

**Content is pre-built, original, and local.** Don't build a runtime scraper: it's brittle, needs internet (defeating the offline design), and republishing Pinside text verbatim is a copyright problem. Instead, research the facts from Pinside / IPDB / the web ahead of time, write **original** summaries, and bundle them as local static content (markdown or JSON) on the party server. Editable, fast, and available with zero internet. *(This content can be produced as a separate workstream in parallel with the app build.)*

---

## 6. Scoring model

**Teams:** 8 teams of 5, assigned **randomly at registration**. Each new signup drops into the *smallest current team* (random tiebreak), so teams stay balanced no matter who arrives when. On assignment the player gets a "You're on **[Team]**!" reveal.

**Per machine:** each team's **best score** ranks it; placement points awarded:

| Place | Points |
|-------|--------|
| 1st | 100 | 2nd | 85 | 3rd | 73 | 4th | 63 | 5th | 55 | 6th | 48 | 7th | 42 | 8th | 37 |

(Single config table — tune freely. Ties split the average of tied places.)

**Participation points:** **+3 per logged play**, to the player's team (soft cap ~10 counted plays per person). Lets an eager beginner help their team without being good.

**Team total** = placement points across all 6 machines + participation points.

**Individual crowns (team-independent):** highest single score on each machine = that machine's champion.

*Swap option:* to reward raw dominance, replace the per-machine points function with `team_best ÷ machine_top × 100`. Same data model.

## 7. Prizes

**Earned:** overall champion **team** · 6 **machine champions**.

**Funny / skill-free** (✅ = app computes automatically):
- **The Big Whiff** — lowest single score ✅
- **The Grinder** — most plays logged ✅
- **Globetrotter** — played all six machines ✅
- **Heartbreaker** — finished 2nd on a machine ✅
- **Beginner's Luck** — top score among self-declared first-timers ✅
- **The Match** — draw 00–90 at the end; best score ending in those digits wins (classic free-game raffle) ✅
- **The Tilt** — most tilts, self-reported (manual)

## 8. Roles

- **Player** — registers, photographs/enters scores, reads game guides, watches team rank.
- **Host (you)** — manages machine/team list, voids bad entries, opens/closes party, triggers reveal.
- **TV overlay** — read-only, always live.

## 9. Flows

**Join:** Scan TV's QR → register (nickname + emoji + first-timer?) → randomly dropped onto the smallest team → "You're on **[Team]**!" → in.
**Log score:** Scan machine QR *or* pick machine → photo (or manual) → confirm → logged, standings update everywhere.
**Learn:** From any machine page, open its guide; from home, open About Pinball.
**Close:** Host ends party → TV reveal: champion team, 6 machine champions, funny awards.

## 10. Screens

**TV overlay (real-time):** team leaderboard (8 rows, movement indicators) · rotating machine spotlight (high score + leader) · activity ticker · persistent join QR · winner-reveal mode.
**Phone — player:** register · machine list · machine page (photo / manual / guide) · About Pinball · "my team & me."
**Phone — host:** open/close · edit teams & machines · void/edit entries · run reveal · show QR.

## 11. Data model

- **party** (single row): name, status, points_table (jsonb).
- **teams**: id, color, name.
- **machines**: id, name, sort_order, active, **guide fields** (manufacturer, year, theme, how_to_play, scoring_tips, history — text/markdown).
- **players**: id, display_name, emoji, team_id, first_timer (bool), session_token, joined_at.
- **scores**: id, player_id, machine_id, value (bigint), ai_extracted (bool), voided (bool), created_at.
- **content** (single row): about_pinball (markdown).

Guide/content text can also live as bundled static files rather than DB rows — whichever is easier to edit. Standings are computed live and pushed over WebSocket, so any new score or void recalculates instantly on the TV and all phones.

## 12. Tech stack & architecture

Local inference makes **the MacBook the party server.** All 40 phones and the TV connect to it over local WiFi.

- **The laptop runs:** the app server, the database + realtime, and **Gemma 3 multimodal** (LM Studio/Ollama).
- **Frontend:** React — `/tv` (full-screen overlay, HDMI to the TV), `/` (player), `/host`, `/machine/:id` (deep-link target for machine QRs).
- **Data + realtime:** **fully local (recommended)** — Postgres or SQLite + a small Node/Bun server with WebSocket broadcast; **works with zero internet**. *Hybrid alternative:* Supabase cloud for data, laptop only for inference (simpler build, but depends on venue internet).
- **AI:** Gemma 3 27B multimodal (12B fallback) via the laptop's OpenAI-compatible endpoint.
- **Identity:** anonymous session token in `localStorage`. No Clerk.

**The constraint is the network, not a secret key.** Give the laptop a stable LAN IP or `.local` hostname, confirm the WiFi allows client-to-client traffic (some routers block it), and stop the laptop sleeping. One machine doing inference + serving is fine: reads are a few seconds each, load is bursty but light (~200 reads over two hours).

## 13. Scope / cut line

**P0 (the spine):** register with team · pick/scan machine · photo→local-AI read + confirm · manual fallback · team standings · machine crowns · live TV overlay · host void.
**P1:** machine QRs · game guides + About Pinball · activity ticker · winner-reveal animation · auto funny awards · multiplayer score picker.
**P2:** achievements/badges · head-to-head · multi-party history · handicapping.

*(Game-guide content is a parallel workstream — write it independently of the app build.)*

## 14. Open questions

- **Data layer** — fully local (zero-internet) or hybrid (Supabase + local inference)?
- **Network** — does the party WiFi allow client-to-client traffic, and does the laptop have a stable address the phones can reach?
- **Model check** — test Gemma 27B vs 12B on each display beforehand; pick the smallest one reliable on the '81 Centaur/Fathom segments.
- **Participation cap** — ~10 counted plays per person, or uncapped?
- **Prize count** — how many funny awards to actually hand out?
