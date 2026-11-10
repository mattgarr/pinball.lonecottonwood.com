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
- **Brightness + master dimmer (Nov 10):** the strips are the garage's main light, so every look must light the room.
  - Why it was dim: ambient layers ran at segment bri 170 and presets set WLED's master bri (Attract 170, Calm 90, Showcase 200 with a bri-90 Aurora base, Cozy 110); Aurora at ix 128 draws ~11 sparse waves over black, Plasma at ix 128 dips most pixels toward black, Pacifica is a deep-ocean palette, Twinklefox at ix 160 lights only 6 of 8 pixels.
  - Now: all ambient/preset layers run at segment bri 255 (Calm 170–200, Showcase walls 230); Aurora ix 255 + slower (20 long-lived waves) in turquoise/purple/teal; Plasma and Twinklefox ix 255; Pacifica replaced by WLED "Running" (id 15, blue/teal swells over teal) in Attract and Calm; Colorwaves leads with teal/pink/turquoise. Same cool palette, brighter shades first.
  - Measured with the simulator's WLED models (`render.js` now follows FX.cpp for Aurora, Plasma, Flow, Twinklefox, Colorwaves, Running; master bri is drawn after gamma 2.8 like the strips). Mean perceived light, top run, before → after: Colorwaves 19→32, Plasma 11→26, Pacifica 10→Running 51, Flow 31→46, Aurora 8→37, Twinklefox 22→35; Calm 10/29/10 → 34/33/30; Showcase 13→25; Cozy 27→39. Tests enforce floors (`presets.test.js`).
  - **Dimmer** (host lights card): WLED's master brightness (top-level `bri`), 5–100% slider + 25/50/75/100 buttons. No preset or app moment sets master bri any more, so the dimmer (and the remote's brightness buttons) stays put through playlists, presets and moments. Stored as a retained MQTT message on `<channel>/dimmer` (`lib/lights/dimmer.js`); the TV applies it on start, after reboots (also when the party is closed: bri alone doesn't stop WLED's playlist) and with every full re-push; it also follows WLED's `<channel>/g` reports so remote changes are remembered. With no TV driving, the host page sends `{bri}` itself (to `/sim` in simulator-only mode).
  - WLED setup: set LED Preferences → "Default brightness" to 255 (presets no longer set brightness, so that's the level at power-up until the TV or the dimmer sets it). **Re-download and re-upload the controller presets** (host → Lights → Download controller presets) to get the brighter standalone shows.
- **Not done:** the optional "live mirror" of real LED colors (needs a LAN connection to WLED, which a cloud page can't reach). Effect IDs are fixed in `config.js`, because MQTT can't fetch `/json/eff`; WLED keeps IDs stable.

## Full bug bash (Nov 10)
Four review agents (lights, guest flows, host/backend security, TV/scoring) plus a Playwright sweep of every route as visitor and host at phone and desktop sizes (51 checks, all clean). Fixed and deployed:
- Reveal always walks all 12 prizes (no-winner slides when the one-prize-each rule or no Match number leaves a prize empty).
- Guests: sign-in survives network blips (whoami retries; a stale players list never signs anyone out), raw selfies are never published (join sends only the pixel art), scanner sees server errors, "Type it instead" opens the keypad, duplicate-nickname race message, debounced player refetch, newly logged scores don't vanish on refresh.
- Host: unlock renews on every host action (no mid-party expiry), confirms for switching events and ending the reveal, Match number check, no host calls when locked, phone overflow fixes, bulk emails send exactly the confirmed list (skip bounced), results emails only to players with games.
- Scoring/TV: ranks follow the prize order (no shared #1), The Match ignores the final 0 with a fair tie-break, attract spotlights actually run, no takeover parade after the Mac sleeps or an event switch, correct TOP SCORE badge and ranks for all players, toast and audio-after-sleep fixes, email machine fallback.
- Migration 0023: a score photo counts as proof only for whoever first used it (no borrowing someone else's photo to skip review). Run Nov 10.
Known, accepted (low risk at a friends' party): `link_by_email` can link anyone who types a listed guest's email; PIN-lockout griefing on rejoin; `host_check` is guessable only if the passcode is weak; `reveal_step` is shared across events.


## Reveal v2 + Match + PIN (Nov 10)
- Reveal order = prize precedence: Grand Champion, 2nd, 3rd, six machine champions (board order), The Grinder, The Big Whiff, The Match. Build-up per prize: Grand Champion 3-2-1 only; 2nd and 3rd walk the ratings (no countdown); machine champions, Grinder and Big Whiff 3-2-1 then a walk; The Match its draw and spin. A walk goes down that prize's standings from the top, stamps "WON <prize>" on anyone who already has one, and stops on the highest person without a prize (`WalkList` in `components/Reveal.jsx`). Empty prizes walk off the end ("Everyone here already has a prize!").
- The Match works like a real pinball Match: the host page draws 00/10/…/90 at "Start the reveal" (kept if the reveal is restarted). Each player's TOTAL points (all games added up, one entry per player) is matched on its last two digits; everyone matching is in the tie-break; if nobody matches, everyone left without a prize is. The tie-break is a fixed shuffle of the draw; the TV shows the number roll and a slot-machine reel (`MatchSpin`). `/tv?reveal=40` previews with a given draw.
- Rejoin PIN: 10 wrong tries before the 2-minute lock, "N tries left" for the last 3 (migration 0024, run in production).

## Access control (Nov 10)
Matt: no random sign-ups; strangers see only a landing page.
- **Landing page** (`routes/Landing.jsx`, `landing.css`): shown by `App.jsx` for every guest route (/, /join, /ranks, /me, /machine/N, /about, …) unless this browser is "in" (`isAuthorized()` in `lib/access.js`: a player token, a party code, a host unlock, or the TV Mac's saved lights topic). It has "Have a party code?" (party password), "I already joined" (→ /rejoin) and a "Need help?" form. Open to visitors: /host* (own passcode), /rejoin, /join?invite=… (ticket links). /tv and /lights-sim use `components/AccessGate.jsx` (same rule); /host/qr needs the host unlock.
- **Server gate (migration 0030, run Nov 10):** `join_party` has a 6th arg `p_access` and returns `{error, access:true}` without one of: the party QR key, the party password (bcrypt, typed any case/spacing), a ticket link token (`event_invites.token`), or a player token from that phone (adding a partner). 20 wrong passwords in a minute lock the password (only) for a minute; QR key/ticket links/signed-in phones are never locked. `party_access` (no API grants) holds the key, the password (plain, for the host to read out, plus its hash) and `signups_open` (pausing blocks QR key + password; ticket links still work). Public RPCs: `check_party_access`, `send_help_request` (30/hour party-wide, length caps; stored in `help_requests`, never emailed). Host RPCs: `host_party_access`, `host_set_party_access`, `host_help_requests`, `host_help_done`.
- **QR codes:** `/host/qr` and the TV's join QR carry `?k=<key>` (`partyUrl()`); the app strips it from the address bar, remembers it (`pw.access`) and checks it. A browser learns the key from the host unlock (`pw.joinKey`). "New QR key" on the host page invalidates printed codes.
- **Host page → "Party access" card** (`components/HostAccess.jsx`): shows/changes the password, new random password, print QR codes, pause/open sign-ups, new QR key. **"Help requests"** card with a count badge and Done/Reopen.
- **Still publicly readable via the API (publishable key):** machines, events (incl. ticket_url), event_machines, event_entries, party, lights_settings, scores, and players' nickname/emoji/color/8-bit avatar. Not readable: emails/guest list (`event_invites`, `player_contacts`), PINs, tokens, raw selfies, party_access, help_requests. The pre-join `pixel-avatar` mode is still open (capped 200/hour).

## Free play + tournament schedule (Nov 10)
The night: doors open → **free play** → tournament auto-starts at the set start → auto-ends at the set end (+3 min to log the last game) → **results sealed** → reveal (host) → **free play** until the end.
- **Data rule:** every score is tournament or free play (`scores.free_play`), decided by the database at insert time from its own clock (`_is_free_play`): free play when the event is in manual free play, before `tourney_starts_at`, or at/after `tourney_ends_at + 3 min`. No times set = as before. Standings, prizes, the reveal, the results email and Ranks/Me only count tournament scores (`computeStandings`/`computeAwards` in `scoring.js` skip `free_play`; `emailResults.js` filters too). Changing the times re-tags the event's scores by `created_at` (not ones the host set by hand or ones after the manual free-play switch). Undo of a tournament score is refused after the logging window or during the reveal. Review flags only tournament scores.
- **Migrations (all run in production Nov 10):** `0025_free_play.sql` (columns, `server_now`, `host_free_play`, `host_set_schedule`, `_mirror_party`), `0026_schedule_fairness.sql` (3-min grace, re-tagging, `host_add_score(..., p_counts)`, `host_set_score_kind`, undo rule, review rule), `0027_clear_free_play.sql` (`revealed_at`, Clear test scores also resets free play).
- **Host page:** "Tournament times" card (start/end in Pacific time, Save/Clear, Start now / +15 min / End now; +15 works until the reveal starts). End of night: End the tournament (sets the end to now, so logging and sign-ups stay open as free play) → Start the reveal (warns about scores still to double-check) → **Start free play / End free play** → Email results. All scores list: Counts / Free play toggle per score. Add score: "Counts: by the clock / for the tournament / free play".
- **TV:** free play (before the start and after the awards) shows the free-play board: live score ticker on top, six full-height high score tables (every game tonight, one row per player, sky-blue bar = best set in free play), news crawl. Countdown chip under the logo (starts in / ends in / log your last scores). Clock takeovers: start 5…1 min, TOURNAMENT IS ON; end 15 (LAST CALL), 10, 5 (START YOUR LAST GAME NOW), 4…1, a full-screen 10…1, then END OF TOURNAMENT / GAME OVER. Each fires once (remembered in localStorage `pw.clockFired`) and only within 30 s of its time, so a TV that slept doesn't replay them. From 15 min before the end until the reveal, results are **sealed**: Top Players #1–3, the Wall of Shame and the Prizes panel are hidden; Ranks/Me show "Results sealed". The last 15 min also show the closest-battle spotlight without waiting for a quiet room. The TV clock is synced to the database (`lib/clock.js`, `server_now`).
- **Previews:** `/tv?freeplay`, `/tv?freeplay=pre`, `/tv?clock=start:5|start:0|end:15|end:5|end:0|final`, `/tv?chip=end`, `/tv?sealed`.
- **Sound hooks (for the audio module):** the TV dispatches `window` event `pw:clock` (in `routes/TV.jsx`, `emitClock`): `{what:'mark', side, minutes}` at each minute card, `{what:'start'}` / `{what:'end'}` at 0, `{what:'tick', n}` each of the final 10 seconds. No sounds are played for these by the TV itself.
- **Lights:** `useLightsDirector().onClock(what, n)`: minute mark = gold bounce, start = white bounces + green wash, final 10 s = red pulses getting brighter, end = white strobes then dark, held until the reveal (or `resume` if the end is pushed back).
- **Phones:** a phase note on Play, the machine page and Me ("Free play until 7:30…", "Tournament on: ends at 10:30", "Play's over! … still counts for 2:41"); the confirm step warns "This will be FREE PLAY"; after the end, a full-screen "Awards starting soon · look at the TV" card (closable, free play continues).
- **Before the party (Matt):** on /host set Tournament times (e.g. start 6:30 PM, end 9:30 PM on Nov 14) and press Save times; press "Clear test scores" (it also clears the old test reveal and free play). The schedule is NOT set in production yet.
- Tests: `lib/schedule.test.js` (phases, edges, takeover schedule, no backlog, clock offset, Pacific time) and `lib/freeplay.test.js`.
