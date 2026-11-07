---
name: pinball-deploy
description: Build, verify and publish Pinball Wizard to pinball.lonecottonwood.com (GitHub Pages), plus pre-party checks like wiping test data. Use when the user says deploy/ship/publish, or before the party.
---

# Ship Pinball Wizard

## Deploy
1. Build check: `cd web && npx vite build --outDir /tmp/pw-check --emptyOutDir`. It must print `✓ built`.
2. Commit the source to `main` (repo `mattgarr/pinball.lonecottonwood.com`, public). Never commit `HOST_PASSCODE.txt`; it's gitignored.
3. `scripts/deploy.sh`: builds `web/dist` (including `404.html` for deep links, `CNAME`, `.nojekyll`) and force-pushes it to `gh-pages`.
4. Verify after about 1 minute:
   - `curl -sI https://pinball.lonecottonwood.com/` returns 200.
   - `curl -s https://pinball.lonecottonwood.com/ | grep -o '<title>.*</title>'`
   - A deep link like `/machine/3` returns the 404.html SPA shell (status 404 is expected, and the page renders).

## Live checks (no browser needed)
- Publishable key and URL: see `web/src/lib/store.js`.
- `curl $U/rest/v1/machines?select=id,name -H "apikey: $K"`
- Rejoin a test player (PIN 1111) via `rpc/rejoin` to get a token, then `rpc/submit_score`.
- Photo reader: POST `$U/functions/v1/read-score` with `{token, machine_id, image: dataURL}`. It returns `{scores, confidence, note, photoPath}`.

## Before the party
- Host page → "Start fresh" → type WIPE. This deletes all players and scores, and the test players: Test Tina, Flipper Fran, Tilt Tom, Multiball Max, TV Test Ace.
- The host passcode is in `HOST_PASSCODE.txt`. Never print it in chat.
- Print the QR sheet: `/host/qr`.
- Supabase free projects pause after 7 idle days, so open the site once mid-week.
- TV: open `/tv` full-screen on the 65" OLED. It keeps itself awake and drifts slowly against burn-in.
