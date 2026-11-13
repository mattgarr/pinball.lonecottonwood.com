# Woodside Pinball — Run of Show (Sat Nov 14)

Plain steps for whoever runs the night (Matt or Stacia). Everything happens on the **Host page**
(`pinball.lonecottonwood.com/host`, unlock with the host passcode) and on the **TV Mac** in the garage.

The example times below assume **tournament 6:30 PM to 9:00 PM (what the Nov 12 emails told guests)**. If you pick other times, shift everything.

---

## A. Setup (the afternoon of the party)

### On your phone or laptop (Host page)
1. **Clear test scores.** Scroll to *Setup (before the party)* → *Clear test scores* → type `CLEAR` → *Clear scores*.
   This also clears the old test awards and the test Match number. Players who already signed up are kept.
2. **Set the tournament times.** *Tournament times* card → Starts `Nov 14, 6:30 PM`, Ends `Nov 14, 9:00 PM` → **Save times**.
   The card should say "Now: Free play: the tournament hasn't started yet".
3. **Party access card:**
   - Read the **party password** so you know it (guests without a QR code type it on the welcome page).
   - **Print QR codes ↗** → print and put one on every machine and by the door. (Only reprint if you pressed *New QR key*.)
4. **Garage lights card:** *Download controller presets* and upload them to the WLED controller (Config → Presets → restore),
   so the remote's shows are the brighter versions. In WLED LED Preferences set **Default brightness 255**.
   Set the **Dimmer** to taste (75–100% is good for a party).

### On the TV Mac (in the garage)
5. Plug the Mac into power. System Settings → never sleep while plugged in; turn on **Do Not Disturb**.
6. Open Terminal and run `caffeinate -dims` (leave that window open all night: it keeps the Mac awake).
7. Control Center → Sound → pick the **WiiM** (AirPlay). Mac volume 100%; set the room level on the WiiM.
8. In Chrome: open `pinball.lonecottonwood.com/host` and unlock it once (this lets the TV drive the lights, the audio and the AI announcer).
9. Open `pinball.lonecottonwood.com/tv`, press **Cmd+Ctrl+F** for full screen.
10. Move the mouse to the bottom-right corner → click **"Lights: click to drive the garage lights from this screen"** (once).
11. Host page → *Audio* card → **Connect Spotify on the TV** (log in on the Mac if asked, click Agree).
    The TV shows "Spotify connected". Pick the **Playlist**, set Music ~60%, pick the **Announcer voice**
    (*Preview here* plays it on your phone). The announcer is an AI voice: it reads the countdowns, new machine
    records and new #1s with names and scores, welcomes people as they join, and names each winner in the reveal.
    The four toggles under it switch each kind off; *Say something on the TV* makes it say anything you type.
    *Say names like…*: add any name it says wrong (`Name=how to say it`; Stacia is already "Stay-sha").
    **Announce booth:** every few minutes two hosts (Tiffani the valley girl and Donnie the fun-center DJ;
    change them under *In the booth*) chat about the night and gently roast people, and one of them throws in a quick
    one-liner when a score lands (a personal best, a near miss, a first game, a rough one; at most every 90 seconds).
    With the booth on, Tiffani and Donnie also do the countdowns, records, welcomes and the reveal winners. *Play one now* to hear one;
    *Skip bit* cuts one off. **Commentary** (top of *Party night* and of the Audio card) sets how much talking
    there is in one tap: Full booth / Chill booth / Announcer / Effects only.
12. **Click the TV once** (anywhere). The "CLICK FOR SOUND + MUSIC" banner goes away. Do this after every TV reload.
13. On the Audio card press the test buttons (Big moment, Starts in 5, Final 10 s, Reveal mute, Match spin) and listen in the garage.
14. **Audio delay** (Audio card): AirPlay plays about 2 seconds behind the screen, so the TV plays its countdown
    boops, the GAME OVER beep and the reveal's 3-2-1, stings and Match spin that much *early*. It starts on
    **Auto** (what the Mac reports, else 2.0 s). Press **Auto sync with mic**: Chrome on the Mac asks for the
    microphone once, click **Allow**; the garage hears five short chirps (about 25 s) and the card shows the result
    ("Mic sync 1.9 s · confidence high"). Then press **Sync test**: three beeps, and the TV flashes white where
    each beep should land. If they don't line up by ear, choose **Manual** and nudge the slider (beeps late → more,
    beeps early → less). **If the WiiM is connected another way** (a cable or HDMI: Manual, about 0 s; Bluetooth:
    Manual, about 0.2–0.3 s), lower it to match.

**Check:** the TV shows the **FREE PLAY** high score board with "TOURNAMENT STARTS IN …" under the logo. Done.

---

## B. The night, minute by minute

| Time | What you do | What the room sees and hears | What phones show |
|---|---|---|---|
| **6:00** doors | Nothing. Greet people. | TV: FREE PLAY board, six high score tables, countdown "tournament starts in 30:00", music playing. | Guests scan a machine QR (or type the party password) → join: nickname, selfie → 8-bit portrait, 4-digit PIN. Phone note: "Free play until 6:30: just for fun." |
| **6:25 – 6:29** | Nothing. | A full-screen card each minute: "TOURNAMENT STARTS IN 5 … 1", a chime, the announcer, music dips, lights bounce gold. | Same note. Scores logged now are warm-ups (don't count). |
| **6:30** | Nothing (it starts by itself). | **TOURNAMENT IS ON**: fanfare, announcer, green lights. The board switches to the tournament: machine leaderboards, Top Players, Wall of Shame, Prizes, news crawl. | "Tournament on: ends at 9:00." Every score counts now. |
| **6:30 – 8:45** | Watch the Host page now and then: **Double-check these** (OK or Remove), **Help requests**. Phone died? *Add or fix a score*. Kid without a phone? *Add a player without a phone*. | Takeovers for new machine records, new #1, rankings unlocked; Wall of Shame; spotlights when it's quiet. | Snap the score (camera) or type it in. Ranks and Me show live standings. |
| **8:45** | Nothing. | **LAST CALL · 15 minutes**. Results are now **sealed**: the podium rows, the Wall of Shame and the prizes show "? ? ?". | "Last call! Results are sealed until the awards." Ranks shows "Results sealed". |
| **8:50, 8:55 – 8:59** | Nothing. | "10 minutes", then "START YOUR LAST GAME NOW" (5), then 4 … 1. | — |
| **8:59:50** | Nothing. | Full-screen **10 … 1** with a boop each second, lights pulse red. | — |
| **9:00** | Nothing. | **GAME OVER / END OF TOURNAMENT**, long beep, "time's up", white strobes, then a warm glow in the garage. | "Play's over! Log your last game now: it still counts for 2:59." |
| **9:00 – 9:03** | Let people log the game they just finished (3 minutes). | Under the logo: "PLAY OVER · log your last scores". | Countdown on the phone. |
| **9:03** | Get everyone to the TV. Grab the prizes. | **THE RESULTS ARE IN · awards ceremony starting soon · gather round the TV** (no winners shown), the announcer says the awards are coming. Music keeps playing. | Full-screen "Awards starting soon · look at the TV" (guests can close it and keep playing free play). |
| **~9:10** | Host page → *End of the night* → **🎉 Start the reveal**. A bar appears at the bottom of your phone: **◀ Back / Next ▶**, what's on the TV, and who wins next (only you see it). | Music fades out. **AWARDS CEREMONY · 12 prizes · gather round**. Waits for you. | "Awards on now! Look at the TV." Ranks stays sealed. |
| | Press **Next**. | **Grand Champion**: 3-2-1, the winner, confetti, lights burst. | |
| | **Next**, **Next** | **2nd** and **3rd Place**: the TV walks down the ratings (anyone with fewer than 3 machines is skipped) and stops on the winner. | |
| | **Next** × 6 | Each **machine champion**: 3-2-1, then a walk down that machine's scores (anyone who already won is stamped "WON …"). | |
| | **Next**, **Next** | **The Grinder** (most games), **The Big Whiff** (lowest rating, sad trombone, roast with love). | |
| | **Next** | **The Match**: a number rolls 00 … 90 (like a real pinball Match), then a slot-machine reel spins through everyone whose total points end in it. | |
| | **Next** | **THANKS FOR PLAYING**: all 12 winners on one screen, "Winners up front · GROUP PHOTO!", the big lights finale. **Take the group photo.** | |
| **~9:30** | On the bottom bar press **Start free play ▶**. | The high score board comes back, music fades back up, the announcer says free play is open. The crawl lists tonight's winners. | Ranks shows **Tonight's winners**; Me shows "Your prize". Free play is open (just for fun). |
| **End of night** | *End of the night* → **Close the party**. | TV: FINAL RESULTS board ("Thanks for playing!"). The lights go back to the controller's own show. | "Scoring's closed for tonight. Thanks for playing!" |
| **Next morning** | *End of the night* → **Send me a sample** (to your own email), check it, then **Email results**. Only players who asked for results get one. Send it **once** (100 emails a day limit). | — | — |

**Winner not there?** A friend accepts for them (the TV says so). **Made a mistake mid-reveal?** Press ◀ Back (the TV jumps straight to that winner without replaying the build-up).

---

## C. If something goes wrong

| Problem | Fix |
|---|---|
| **TV shows "CLICK FOR SOUND + MUSIC"** | Click the TV once with the Mac's mouse. |
| **TV went black / Mac slept / page looks stuck** | Wake the Mac, click in Chrome, press **Cmd+R**, then click the TV once. Nothing is lost; the countdowns don't replay old moments. |
| **"⚠ offline" in the TV's corner** | Garage Wi-Fi dropped. It fixes itself when Wi-Fi is back; press Cmd+R if it stays for more than a few minutes. |
| **No music** | Host page → Audio → *Reconnect Spotify*, then click the TV once. Still nothing: open Spotify on the Mac and play the playlist there (the TV's sounds still work). |
| **The announcer is quiet but sound works** | Host page → Audio: *Announcer: on* and its four toggles. A brand-new line takes ~5 s; offline, only the countdowns speak (from saved clips). Unlock /host on the TV Mac once more if it's been over a week. |
| **The booth said something off** | *Skip bit* on the Audio card, then *Roast: Gentle*. |
| **Booth getting annoying** | **Commentary** (top of *Party night*): *Chill booth* (long bits half as often and shorter; one-liners stay), *Announcer* (no booth, no one-liners; one voice) or *Effects only* (no voices at all). It cuts off a bit that's playing. |
| **Countdown beeps or reveal sounds don't match the screen** | Audio card → **Sync test** (each beep should land on a white flash). Beeps late: *Manual* and slide the delay up; early: down. Or **Auto sync with mic** again. Switched the WiiM to a cable/HDMI or Bluetooth? *Manual*, about 0 s (cable) or 0.2–0.3 s (Bluetooth). |
| **No sound at all in the garage** | Mac Control Center → Sound → pick the WiiM again (AirPlay). Check the WiiM's volume. |
| **Lights stuck or wrong** | Host page → Garage lights → *Back to attract loop*. Or use the remote (button 1 = attract show). Too bright/dim: the **Dimmer**. |
| **Running late** | *Tournament times* → **+15 min** (pushes the end back; works until the reveal). The countdowns follow. |
| **Want to start right now** | *Tournament times* → **Start now**. |
| **Want to end early** | *Tournament times* → **End now** (3 minutes to log the last games, then the "results are in" screen). |
| **Someone typed a wrong score** | *All scores* → **Remove** it, then *Add or fix a score* with the right number. |
| **A guest can't get in** | Tell them the party password (Party access card), or they tap "I already joined" and use their nickname + PIN. Forgot the PIN: *Players* → **Reset PIN**. |
| **Rude nickname** | *Players* → **Rename**. |
| **The TV is behind during the reveal** | The bottom bar says "TV: catching up…" or "TV not seen". Wait a few seconds; if it stays, press Cmd+R on the TV. It comes back on the same prize. |
| **A late score fix changes a prize after the reveal started** | The prizes were saved when you pressed Start the reveal, so nothing changes by itself. Only press *Recompute prizes* if it's a real correction. |
| **Started the reveal too early** | *End the reveal* (the TV goes back). Starting again keeps the same Match number. |
| **Closed the party by mistake** | *Close the party* → **Reopen**. |
