# Woodside Pinball: handoff notes (Nov 8, 2026)

This file is for the next AI assistant (Antigravity) taking over from Claude Code. Read it fully before changing anything.

## What this is

**Woodside Pinball** is a party leaderboard app for a home pinball party.
- **Event:** "The Ultimate Woodside Pinball Tournament" on **Sat Nov 14, 2026, 6–10 PM** at the Garr home, 252 Raymundo Drive, Woodside.
- **Hosts:** the Garrs (Matt and Stacia) and the Simkovers (Meghan and Zack). Credit both families in every email.
- **How it works:** guests sign up on their phones, log scores per machine (with a camera score scanner), and watch a live TV board at `/tv`. Prizes are awarded at the end of the night.

| Piece | Where |
|---|---|
| Website (Vite + React) | `web/`, published to GitHub Pages at https://pinball.lonecottonwood.com |
| Database + server functions | Supabase project `llmggdjxiffkwnjuogxf` |
| Email | Resend, sending from `pinball@lonecottonwood.com` (free plan: **100 emails/day**) |
| Schema history | `supabase/migrations/0001…0014_*.sql` (run by hand, in order) |
| Server functions | `supabase/functions/email-roster`, `email-results`, `resend-alerts` (plus `pixel-avatar`) |
| Scoring and prizes | `web/src/lib/scoring.js` |
| Shared data store | `web/src/lib/store.js` |
| Host guest manager | `web/src/routes/HostGuests.jsx` (`/host/guests`) |
| TV board | `web/src/routes/TV.jsx`, `web/src/components/tv/*`, `web/src/components/Reveal.jsx` |

`server/` and `config.json` are dead code from an old design. Ignore them.

## How to deploy

- **Website:** run `bash scripts/deploy.sh` from the repo root. It builds and pushes `web/dist` to the `gh-pages` branch, and the site is live about a minute later. Delete `web/public/_emtest` first if it exists.
- **Database changes:** paste the new `supabase/migrations/00NN_*.sql` file into the Supabase dashboard SQL editor and run it. There is no Supabase CLI and no database password: never use psql.
- **Server functions:** edit the code in the Supabase dashboard (Edge Functions → function → Code), click **Deploy updates**, confirm, and wait for the "Successfully updated edge function" message before leaving the page.
  - Keep the local file in `supabase/functions/` identical to what you deploy.
  - Typing into the dashboard editor auto-closes quotes and brackets. Setting the editor model value with JS (`monaco.editor.getModels()[0]`) and comparing a SHA-256 of the text against the local file works best.
- **Step-by-step skills:** `.claude/skills/` has detailed walkthroughs: `supabase-dashboard`, `pinball-deploy`, `html-email` (Gmail dark-mode rules), and `ipdb-backglass`.

## Rules (from Matt)

- **Never print the host passcode.** It's in line 3 of the gitignored `HOST_PASSCODE.txt`. Matt signs in to the host pages himself in the browser.
- **Never type API keys, passwords or webhook secrets into websites.** Matt pastes those himself.
- **Never email real guests without Matt's explicit OK.** Test samples go only to mattgarr@gmail.com (or sasherman@gmail.com when asked), using the guest manager's "Send yourself a sample".
- **Watch the Resend quota.** The free plan allows 100 emails a day, and tests count. Plan on one real send per day.
- **Keep the all-caps 8-bit look** in the guest-facing app and emails. The host guest manager uses plain, modern styling.
- **Email copy rules:**
  - Don't say "guest list" or "on the list".
  - No parking line, no "trash talk", no prize list. Just say "Prizes at the end of the night."
  - Unpaid invites show "TICKETS: $150 PER PERSON" and a buy button.
  - Sign-up links and QR codes go only to paid guests.
- **Write for a non-technical host:** Stacia must be able to run everything without help.

## Current state

- **Guest list:** 77 rows (17 paid). First emails went out Nov 8: 60 invites and 16 "You're in!" QR emails.
- **Bounce alerts are live:**
  - A Resend webhook calls the `resend-alerts` function. It checks the Svix signature against the Supabase secret `RESEND_WEBHOOK_SECRET`, with JWT verification turned OFF for this function.
  - It emails Matt about each bounce or spam complaint, and marks the guest with `bounce_*` columns (migration 0013), which shows as a red "Bounced" tag in the guest manager.
- **Prizes (12 total):**
  - **The awards:** Grand Champion, 2nd, 3rd, one champion per machine (6), The Grinder, The Big Whiff, The Match.
  - **One prize per person:** `ONE_PRIZE_EACH` in `scoring.js`. If someone wins two, the lower prize passes to the next person in line.
  - **TV:** the prize panel alternates between "overall" and "machines" every 8 seconds, and the end-of-night reveal follows the same order.
  - **Shopping list:** the Google Doc "Woodside Pinball – Awards & Prizes (Nov 14)" (id `14ptAryLZjz33urNHxV-onfHjQ3VspXBEMNXX2sojP_Q`), which matches Matt's Amazon cart.
- **Shared tickets (migration 0014, shipped Nov 8):**
  - One sign-up link or QR can sign up several people, for example a couple on one ticket.
  - The first person attaches to the original row. Each extra person gets their own guest row with `parent_id` set and no email, and the original row's party size drops by one.
  - The sign-up page shows who on the ticket has already joined, and after signing up there's a "Share this link" button.
  - The guest manager shows extra people as "On X's ticket" with a "Shared ticket" tag. `email-roster` skips rows without an email.
  - Tested in SQL with a rolled-back test, but **not yet tested end-to-end on two real phones.**

## Shared-ticket flow (reworked Nov 8 evening, Antigravity)

Matt's direction: **anyone with a ticket link can sign up; no attendance tracking.** So there are no spot counts or caps. Study: `brain/060e222e-…/signup-flow-study.md`.

- **Done and deployed:**
  - **Couples & multi-name tickets** (e.g. `"Chris and Cina Boitnott"`):
    - Greets both by first name (`"Hi Chris and Cina!"`) and asks **"Which one are you?"** with one-tap buttons (`Chris` / `Cina` / `Someone else`).
    - Lets guests fix any misspelling (**"Spelled wrong? Fix it"** on sign-up and **"Wrong or misspelled? Fix it"** on the ME tab), updating both `event_invites.who` and the root ticket's `name`.
    - After the first person signs up, the welcome screen prompts **"Now get [Partner] in"** (and the ME tab shows **"Still to sign up: [Partner]"**) until both are signed up.
  - ME tab "Bringing someone? / Your ticket" box under the rating, listing who's on the ticket.
  - "Bringing someone?" / "Now get [Partner] in" box on the welcome screen after signing up from a ticket link.
  - "This phone will switch players" warning before signing someone up on your phone.
  - Prefilled ticket email has a **"Not yours? Clear it"** link, and leaving the email box unticked when prefilled skips saving email instead of blocking sign-up.
  - A partner's own email (typed at sign-up) is saved to their guest row. They're included in reminder emails (Matt OK'd the extra quota). They don't count as "not emailed".
  - Walk-ins who enter an email matching an unclaimed guest row automatically link to that row (`link_by_email`).
  - "You" is recognized by player ID, not nickname.
  - Guest manager (`/host/guests`):
    - People on a ticket are listed directly under its owner (indented `↳` row) and summarized on the owner's row (`+ Partner`), with `(FirstName)` tags from `who` on coupled tickets.
    - Party size never shows fewer than the people signed up.
    - An automatic **"Joined at the party"** section lists players with no guest row (e.g. joined from a machine QR), each with a 1-tap **"Add to a ticket…"** dropdown (`host_link_player`).
    - "Playing" stat.
- **Migration `0015_ticket_flow.sql`** (`my_ticket`, `invite_info` with ids, `claim_invite` no longer lowers party size and resolves child tokens to root, `set_ticket_email`, `host_walkins`):
  - Tested on a throwaway local Postgres with all migrations applied.
  - **Run in Supabase on Nov 8, ~8:21 PM** (driven through Matt's Chrome via remote debugging + Playwright `connectOverCDP`).
  - Data fix the same night: Chris Boitnott (player "Bad B-nott", id 9) had joined without the ticket link. He was added as guest row 91 under Cina's row 7.
  - Hosts linked: FlyingGoat (player 6) → Matt Garr row 19; Megs (player 8) → Meghan Simkover row 21. Test player Goatay (7) deleted.
  - Tip: drive Supabase through ONE long-lived Playwright `connectOverCDP` session (Chrome asks "Allow remote debugging?" on every new connection).
- **Migration `0016_link_walkins.sql`** (`link_by_email`, `host_link_player`, `event_invites.who`, `set_ticket_who` with ticket-name spelling fix, updated `invite_info` and `host_invites`):
  - Tested end-to-end on a throwaway local Postgres with all 16 migrations applied, plus a rolled-back production rehearsal.
  - **Run in Supabase on Nov 8, ~9:53 PM**, along with setting `who = 'Cina Boitnott'` on row 7 and `who = 'Chris Boitnott'` on row 91.
- **Migration `0017_multi_event.sql`** (`enter_event`, `host_set_entry`, `claim_invite` entering `v_inv.event_id`, and `host_clear_scores` scoped strictly to the active event):
  - **Run in Supabase on Nov 8, ~10:12 PM.**
  - **Events & permanent player accounts**:
    - `HostEvents` is now at the top of `/host` with `+ New event`, `Make active`, `Guest list & emails`, and an expandable `Players (N)` roster per event (plus `+ Add existing player…`).
    - `/host` `Players` card toggles between `In [Active Event]` and `All accounts`.
    - `Ranks` and `Me` let guests switch between individual tournaments (`?event=<id>`) as well as `All-time`.
- **Still to do:**
  - Test on two real phones.
  - Next reminder note: "Coming as a couple? Each of you can use the same sign-up link or QR on your own phone."

## Optional feature (on hold)

**Letting a guest add people in their party by email, with a direct sign-up link and QR for each.** Matt raised this, but shared tickets already cover the need: a partner can use the same link or QR, and the share button makes passing it on easy. Build this only if Matt asks again.

Instead, the next reminder update should carry this line in its note: "Coming as a couple? Each of you can use the same sign-up link or QR on your own phone."

Suggested design, if it's ever needed (confirm with Matt before building):

1. After sign-up (and on the ME tab), add a section: "Add someone on your ticket", with fields for name and email.
2. Add a new RPC, for example `add_party_member(p_token, p_invite, p_name, p_email)`:
   - Check that the caller's player is on that ticket (the parent row or one of its child rows), and that the ticket is **paid**.
   - Cap the number of extras at something sensible, and reject an email that's already on the event.
   - Insert a child row: `parent_id` = the ticket row, the given email and name, `paid` copied from the ticket, `party_size` 1, and a new token. Decrease the parent's party size by one (minimum 1).
3. Send the new person their "You're in!" email with the QR code:
   - `email-roster` currently requires the host passcode.
   - Either add a guest-triggered mode that's only allowed for a just-created child row (checked by the inviter's player token and ticket), or create a small new function.
   - Make sure a random person can't use it to spam emails, and remember the 100/day quota.
4. Show it in the guest manager (child rows already display as "On X's ticket").

## Other open items

- **Before the party:** clear test scores and test players (the Host page has "Clear test scores"), check the TV at `/tv`, and test the score scanner on each machine.
- **Party night:** close scoring, then run the reveal. The Match needs a drawn number from 00 to 99. Then send results with "Email results", which goes only to players who opted in. Avoid sending any other emails that day because of the quota.
- **Cina Boitnott asked** whether both she and Chris can sign up. Yes: both can use the same link on their own phones, and both will now show in the guest list.

## Garage lights (built Nov 9, Claude Code)

The lighting plan is the Claude Doc "Pinball Garage Lighting Plan". Its spec assumed a local server; **the app is cloud-hosted, so the build talks to the lights through a public MQTT broker instead.**

- **How it works:**
  - The WLED controller (Gledopto) subscribes to `broker.hivemq.com:1883`. The channel (Device Topic) is a **secret** generated in the database (`lights_secret`, migration 0021), readable only via `host_lights_topic(p_pass)`; the host lights card shows it. Browsers cache it in localStorage `pw.lightsTopic` once unlocked as host (the TV Mac must unlock `/host` once). The old public topic is retired (it was in the public repo, and was also over WLED's 32-character limit).
  - The **TV page on the Mac** drives the lights: it watches scores, machine champions, leader changes, party open/close and the reveal, and publishes WLED JSON state to `<topic>/api` over secure WebSockets (`wss://broker.hivemq.com:8884/mqtt`).
  - Only a screen marked as the lights driver sends anything: move the mouse on the TV and click "Lights: … drive the garage lights from this screen", or open `/tv?lights=1`. It's stored in that browser.
- **Code:** `web/src/lib/lights/` (`config.js` zones/topic/effects; `engine.js` priorities, restore timers, merging, throttle, reveal choreography; `useLightsDirector.js` the TV driver; `mqtt.js`; `render.js` for the simulator). Tests: `cd web && npm test` (25 engine tests).
- **Pages:**
  - `/host` "Garage lights" card: on/off, simulator-only vs real strips, attract loop, house lights, brightness, a test flash per machine, status dots.
  - `/lights-sim`: live simulator with event buttons.
  - `/host/calibrate`: walk a one-pixel pointer to tape marks, then save the zones.
- **Database:** migrations `0018_lights.sql` (`lights_settings` row: `enabled`, `dry_run`, `zones`; RPC `host_set_lights`) and `0019_lights_music.sql` (`music` column; 5-arg `host_set_lights`, `''` turns music off). **Both run Nov 9.** Defaults: effects OFF, simulator only.
- **Segments** (higher ids draw on top): 0 whole top run, 1 same bounds as 0, 2–7 top machine zones, 8 curb, 9–14 curb machine zones, 15 calibration pointer.
  - **Stacking:** the curb is a second row under the beam. Each machine gets the same pixel width on both (`machineSpanPx`, 84 px: the full curb, centered on the beam). The top run is one continuous pattern (segment 1 has the same bounds as 0), so there's no seam at the wall/beam corners. Segment 8 is made the top run's length and shifted with WLED's segment `of` (offset), so curb and top match pixel for pixel. **WLED output 2 must be set to 235 (the top run's length), not the curb's real 85.**
  - The curb is still its own segment, so it can also do different things: `pingPong()` bounces top ↔ curb (used for a new leader; "Top / curb bounce" in the simulator; `control` cmd `pingpong`).
- **Effects:** ambient effects rotate every 3 min (`ambientCycle`), in a cool palette only (purple, blue, pink, teal, turquoise via WLED palette 4 "Color Gradient" and `coolColors`; no rainbow effects).
  - Machine theme colors (`machineThemes`, chosen with Matt Nov 9): Fathom sea green / ocean blue / seafoam; Centaur lipstick red / wine / chrome; Whirlwind electric blue / storm navy / lightning yellow; White Water river blue / foam white / life-jacket orange; Cactus Canyon sunset gold / deep orange / rose red; D&D purple / magenta / lavender. A score breathes between the player's color and the machine's first color; a champion gets white flashes, then a mirrored chase of the machine's three colors on the top (player color on the curb).
  - **The lights follow the TV screen** (`onHit` / `onTakeover` / `onToast` in `useLightsDirector`, called from `TV.jsx` as things appear): cabinet score → machine breathes; record takeover → champion; new #1 → leader bounce + wash; ranked takeover → room breathes in the player's color; games milestone → gold top/curb bounce; Wall of Shame → slow dim red sag. Joins, PBs, climbs and spotlights get no extra effect. The simulator lists this mapping under its buttons.
  - The TV uses the same machine colors (`machineColors` in `components/tv/theme.js` reads `machineThemes`): a cabinet hit breathes player color ↔ machine color, and a record cycles the machine's three colors.
  - Machine highlights light the top and curb zones together (`scoreAlsoOnTop: true`).
  - The TV's sound and lights buttons appear only while the mouse is in the bottom-right corner (never in the simulator's TV view).
  - After a controller reboot (WLED re-announces "online" on `/status`), the TV calls `engine.resync()` to push the zones and the current look again.
  - Rehearsal: `/tv?demo&lights=1` lets demo moments drive the real strips (plain `?demo` never does).
  - Install / commissioning guide (Claude Doc): https://claude.ai/artifact/X7WEoSWVYhKuVQCZzVHkMh
  - Segments are always sent in ascending id order (WLED appends a missing segment at the next free slot). The curb offset follows WLED's rule (effect pixel i drawn at i + offset); `wledOffsetAdds` in config flips it if the bench test disagrees.
  - Standalone shows: `lib/lights/presets.js` builds WLED presets (1 Attract playlist, 2 Calm, 3 Exciting, 4 Music, 5 Machine showcase, 6 Cozy, 7 House, 8 Off, 9 Next mode = `1~5~`), downloadable from the host lights card; the simulator previews them ("Standalone (no TV)"). Gledopto ESP-NOW remote scene buttons 1–7 = presets 1–7 (check the mapping when it arrives).
  - CLI scripts need `LIGHTS_TOPIC` set to the secret channel.
  - **Idle machine zones are parked** on invisible pixels (330+, past the real curb on padded output 2): WLED paints an off segment black over the base. Effects send the zone's real bounds (`engine.bounds`). The simulator draws off segments black too, like WLED.
  - WLED republishes "online" after every change, so the TV resyncs only on offline → online, plus a minute re-push that skips busy zones. After the party closes (`stop()`), the room belongs to preset 1: no keep-off or re-push, and any app moment re-sends `{ps:1}` when it ends (any JSON to WLED stops a running playlist). mqtt.js: `queueQoSZero:false`.
  - Winner reveal (migration 0022: `party.reveal_step`, `host_reveal_step`): each prize = name + 3-2-1 countdown (lights pulse per count via `revealTick`), then the winner (lights `revealCue`), then it waits. Advance from the host page (Next / Back) or click / Space / arrows on the TV. `/tv?reveal` previews locally (`&lights=1` drives the real strips).
  - Simulator: event buttons make the TV view show the moment (postMessage → `live.inject`), and the lights follow the TV; "Winner reveal" switches the TV view to the reveal; a remote / wall switch / controller button panel previews the standalone presets.
  - Simulator layout (Nov 10): one screen: header · TV view + `components/LightsWall.jsx` (a canvas "garage wall": top run with its wash down the wall, machine silhouettes in their zones and colors, curb glow behind them) sized together to the window height · tabbed controls (Moments / No TV / Ambient) + folded command log on the right.
  - Reveal details: the countdown is keyed to the prize (no winner flash before the 3-2-1); the TV advances the party's reveal only with the host unlock on that browser (`?reveal` preview advances locally); held keys don't skip; the host's Next is optimistic.
  - A fresh engine (host card / simulator, no TV) lays out the zones before its first effect (`needsLayout` starts true). A controller reboot during the reveal re-lays zones before the next cue. Safari back/forward cache: `pageshow` restarts the party lights.
  - Machine-zone effects are always symmetric (`mi` + `rev`, mirrored from the machine's center); nothing scrolls one way across a machine.
  - Stuck-light safety: `destroy()` returns anything mid-flash to rest, and the driver re-sends "off" to idle machine zones every 5 s (a dropped MQTT message can't leave a machine lit).
  - The simulator's TV view publishes on a private channel (`sim/<random>`), so open simulators and test runs don't light each other up. Only the real TV in simulator-only mode uses the shared `sim` topic.
  - Full white flashes (W chip) for champions, new leaders and the final reveal, never faster than 3 per second. Music mode (host card select) swaps the ambient layers for a WLED AudioReactive effect, with score flashes still on top. It needs the AudioReactive usermod and a mic on the controller.
- **Simulator** `/lights-sim`: the TV board (demo, live or off) above the strips, with the curb drawn under the beam. Also: event buttons, an ambient picker, music mode, and "Listen with this Mac's mic". `/tv?lights=sim` drives the simulator only, and demo events count.
- **Topics:** `/api` (real controller), `/sim` (simulator-only mode), `/status` (WLED online/offline), `/director` (TV heartbeat), `/control` (host commands for the TV).
- **CLI:** `npm run lights:test -- --machine whirlwind --event score --color magenta [--hardware]`, and `npm run lights:mock`.
- **Physical machine order** (left to right) is `machineOrder` in `config.js`: Fathom, Centaur, Whirlwind, Whitewater, Cactus Canyon, D&D (ids 2,1,3,4,5,6). Change it there if the machines move.
- **WLED setup Matt still needs to do:** Config → Sync Interfaces → MQTT: enable, broker `broker.hivemq.com`, port 1883, no user/pass, Device Topic and Group Topic as shown on the host lights card. The rest follows the doc (LED prefs, 12,000 mA, presets 1–5, boot preset 1).
- **Not done:** the optional "live mirror" of real LED colors (needs a LAN connection to WLED, which a cloud page can't reach). Effect IDs are fixed in `config.js`, because MQTT can't fetch `/json/eff`; WLED keeps IDs stable.
