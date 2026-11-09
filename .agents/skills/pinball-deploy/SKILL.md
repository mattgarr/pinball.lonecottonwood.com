---
name: pinball-deploy
description: >-
  MANDATORY whenever modifying any file in web/, scripts/, or deploying/shipping/publishing
  Pinball Wizard to pinball.lonecottonwood.com. Covers the required gh-pages deploy script,
  CSS cascade gotchas (.primary vs .ghost heights, 4-size pixel type scale), and mandatory
  visual + bounding-box verification with Playwright before claiming UI work is done.
---

# Ship & Verify Pinball Wizard (`pinball.lonecottonwood.com`)

## 1. CRITICAL: `git push origin main` Does NOT Deploy the Website!

- GitHub Pages serves the **`gh-pages`** branch (built from `web/dist`), **NOT** `main`.
- If you only run `git commit` and `git push origin main`, **nothing changes on `https://pinball.lonecottonwood.com`**.
- **Every single time** you change anything under `web/`, you **MUST** run:
  ```bash
  rm -rf web/public/_emtest
  git add -A && git commit -m "..." && git push origin main
  bash scripts/deploy.sh
  ```
- After running `bash scripts/deploy.sh`, verify that the live asset hash on `https://pinball.lonecottonwood.com` matches the newly built `web/dist/index.html`:
  ```bash
  LOCAL_HASH=$(grep -o 'assets/index-[^"]*' web/dist/index.html | head -n 1)
  curl -s https://pinball.lonecottonwood.com/ | grep -o 'assets/index-[^"]*'
  ```
  Wait/retry (~15–45s) until `curl` returns `$LOCAL_HASH` before telling the user it is live.

## 2. Mandatory Visual & Bounding-Box Check (Never Guess CSS!)

Never claim a UI or layout change is fixed without rendering it in headless Chromium (Playwright) and inspecting both:
1. **Computed bounding boxes (`getBoundingClientRect()`)** — verify that buttons in the same action row or toolbar have identical `height` and `top` (`y`), and that tabs/rows do not overflow horizontally (`scrollWidth <= clientWidth`).
2. **An actual screenshot** viewed with `read_file` so you see what the user sees.

### Important localStorage Format for `/host`
`web/src/lib/store.js` stores the host passcode in `localStorage` under key `pw.host` as JSON **`{"p": "<passcode>", "t": <timestamp>}`** (NOT plain text and NOT `sessionStorage`).
To pre-authenticate Playwright on `/host`:
```js
const pass = fs.readFileSync('/Users/mattgarr/pinballwizard/HOST_PASSCODE.txt', 'utf8').split(/\r?\n/)[2].trim();
await context.addInitScript(p => {
  localStorage.setItem('pw.host', JSON.stringify({ p, t: Date.now() }));
}, pass);
```
To pre-authenticate as a guest player, set `localStorage.setItem('pw.token', '<player_token>')`.

## 3. CSS & Layout Rules in `web/src/styles.css`

1. **Only 4 Pixel Font Sizes**:
   - Never invent ad-hoc pixel font sizes (`8px`, `9px`, `11px`, etc.).
   - Use **only** `--t10` (`10px`), `--t12` (`12px`), `--t16` (`16px`), `--t24` (`24px`) for `--px` (`Press Start 2P`), and `--b10` (`13.333px`), `--b12` (`16px`) for `--pxbody` (`NES Body`).
2. **Button Height Consistency**:
   - In `styles.css`, `.cta, .primary` defaults to `min-height: 58px; font-size: var(--t12) !important`, while `.ghost` defaults to `min-height: 40px; font-size: var(--t10) !important`.
   - Whenever `.primary`, `.secondary`, `<button className="ghost">`, and `<a className="ghost">` sit in the same section or row (such as `.host`), they **must** share the exact same `height: 40px !important; min-height: 40px !important; padding: 0 12px !important; font-size: var(--t10) !important; display: inline-flex; align-items: center; justify-content: center`.
   - When toggling state between two cards (e.g., `Make active` vs `★ Active` in `HostEvents.jsx`), keep a same-sized button/pill in the first slot so flipping state does not shift button positions or row heights.

## 4. Pre-Party / Live Checks
- Host passcode is on line 3 of gitignored `HOST_PASSCODE.txt`. **Never print it in chat.**
- Never email real guests without Matt's explicit OK.
