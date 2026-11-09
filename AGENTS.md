# Woodside Pinball (`pinball.lonecottonwood.com`) — Always-On Workspace Rules

1. **Deploying Web Changes (`bash scripts/deploy.sh` is MANDATORY)**:
   - GitHub Pages serves the `gh-pages` branch, **not** `main`.
   - Whenever you edit anything in `web/`, committing and pushing `main` is **not** enough: you **must** run `bash scripts/deploy.sh` and verify via `curl -s https://pinball.lonecottonwood.com/` that the live asset hash matches `web/dist/index.html`.
2. **Visual & Bounding-Box Verification Before Claiming Done**:
   - After any UI or CSS edit, render the page with Playwright, check computed bounding boxes (`getBoundingClientRect()` — button heights, row vertical alignment, and horizontal overflow), and view a screenshot with `read_file` before telling the user it is done.
   - To authenticate `/host` in Playwright, set `localStorage.setItem('pw.host', JSON.stringify({ p: pass, t: Date.now() }))` using line 3 of `HOST_PASSCODE.txt`.
3. **Typography & Button Consistency**:
   - Strictly use the 4-size pixel type scale in `web/src/styles.css`: `--t10`, `--t12`, `--t16`, `--t24` (and `--b10`, `--b12`). Never introduce extra font sizes.
   - All action buttons in the same row or card (`.primary`, `.secondary`, `.ghost`, `a.ghost`) must have identical height (`40px` in `/host`) and vertical alignment, and stateful cards (like active vs. inactive events) must keep a placeholder button/pill so flipping state never shifts layout.
4. **Safety**:
   - Never print or log the host passcode from `HOST_PASSCODE.txt` or any API keys/secrets.
   - Never send emails to real guests without Matt's explicit confirmation.
