---
name: html-email
description: Build, check and send HTML emails that look right in Gmail (including iPhone dark mode), Apple Mail and other inboxes. Use whenever creating or changing an email template (e.g. Pinball Wizard's email-roster / email-results edge functions), when an email "looks wrong", "turns white", "is unreadable" or "too small" on a phone, or before emailing real recipients.
---

# HTML email that survives Gmail and dark mode

Lessons from 2026-11-08, confirmed on Matt's iPhone in Gmail dark mode. Email clients are not browsers, so build for the worst one: **Gmail on iPhone**.

## What each client does
- **Gmail iOS dark mode inverts every inline color**, even in emails that are already dark.
  - Black backgrounds become white; white text becomes black.
  - Images and emoji are never inverted.
  - Transparent PNGs end up sitting on the flipped (white) background.
- **Gmail Android** partially inverts.
- **Gmail web** doesn't invert.
- **Apple Mail** respects `<meta name="color-scheme" content="dark">` and leaves a dark email alone.
- **Gmail ignores web fonts.** It falls back to the next font in the stack (Courier for us). Apple Mail does load Google Fonts.
- **Gmail shrinks wide emails to fit the phone.** A 568px email shows at about 0.68× on an iPhone, so 12px text reads like 8px.
- **Gmail clips messages over about 102KB** ("View entire message"). Keep the HTML small. The QR table merges runs of cells for this reason.
- **Gmail keeps a `<style>` block in `<head>`** and supports `mix-blend-mode`. It renames classes, but selectors still match. It turns the doctype into `<u></u>` and keeps `<body class="body">`, which is why `u + .body …` selectors target Gmail only.

## The recipe (dark design that stays dark everywhere)
1. **Backgrounds.** Set each one twice: `background-color:X;background-image:linear-gradient(X,X);`. Gmail never inverts the gradient. Use a helper `BG(c)`.
   - Borders get inverted, so draw them as a padded outer cell with a `BG()` color instead (frames, button bevels, image borders).
2. **Text.** Wrap all text in two blend layers, `T(inner)`:
   ```html
   <div class="gb-s"><div class="gb-d">…text…</div></div>
   ```
   ```css
   u + .body .gb-s{background:#000;mix-blend-mode:screen;}
   u + .body .gb-d{background:#000;mix-blend-mode:difference;}
   ```
   - **This only restores WHITE text.** Colored text (yellow, blue, gray) came back dark and unreadable. So in Gmail, force everything inside to white:
     `u + .body .gb-d, u + .body .gb-d *{color:#ffffff !important;}`
   - Other clients don't match `u + .body`, so they keep the real colors.
3. **Size.** In Gmail, make text big and bold, since it's Courier and gets shrunk:
   `u + .body .gb-d div, u + .body .gb-d td{font-size:17px !important;line-height:1.5 !important;font-weight:bold !important;}`
   - For small print, add `class="sm"` and `u + .body .gb-d .sm{font-size:14px !important;}`.
4. **Images and emoji go OUTSIDE `T()`.** Inside, they get inverted into negatives. Put an emoji in its own table cell next to the `T()` text cell.
5. **Color must come from images or gradient backgrounds:**
   - pixel-text PNG headings (`scripts/email-art.py`)
   - number badges as images (n1–n4.png)
   - colored boxes with a `BG()` background and white text
6. **QR codes** go outside `T()`. Draw the dark cells with `bgcolor` plus `background-image:linear-gradient(#000,#000)` on a white `BG()` table, framed by a `BG()` cell. Otherwise Gmail inverts them.
7. **Head:** include
   - `<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">`
   - `<!doctype html>` (Gmail needs it to produce `<u></u>`)
   - `<body class="body">`
   - Don't put risky rules such as `:root{…}` in the `<style>` block. Keep it plain.

## Gmail threading hides content
- Emails with the same subject get grouped into one conversation, and Gmail hides parts that look repeated behind "…". This hid the QR code on 2026-11-08.
- Fix: send every email with a unique `headers: { 'X-Entity-Ref-ID': crypto.randomUUID() }` (Resend supports custom headers). Both email functions do this.
- The editor auto-closes backticks and brackets when you type them. After any find/replace, check the hash again.

## Checking before you send
- **Render locally.**
  1. Copy the template function into a scratch `.ts`, strip the `npm:` imports (stub `qrcode`), and bundle it with `web/node_modules/.bin/esbuild --format=cjs --platform=node`.
  2. Write sample HTML files, put them in `web/public/_emtest/`, and view them via the dev server at phone size.
  3. **Delete `_emtest` before `scripts/deploy.sh`**, because the build copies `public/`.
- **Simulate Gmail dark mode.**
  - Invert every hex color, except inside `linear-gradient(...)`.
  - Wrap the body as `<body><u></u><div class="body">…`.
  - This approximates it, but it isn't proof: only white text really restores. The real test is the user's iPhone in dark mode.
- **Send samples only to the user** (mattgarr@gmail.com):
  - `email-roster` with `test_to` sends both versions, with a fake "Sample Guest" and a link that isn't tied to anyone.
  - `email-results` with `test_to` and made-up results sends one sample and marks nothing as sent.
  - Subjects start with `[TEST]`.
- **Never send to guests without the user's explicit go-ahead.**

## Deploying the functions
See the `supabase-dashboard` skill: retype the flattened file, verify with SHA-256, then **Deploy updates → confirm**.
- Wait for the "Successfully updated edge function" toast **before** navigating away. Leaving early can lose the deploy.
- The editor sometimes auto-inserts a `}` or `)`. A hash mismatch of 1 character usually means that; find it and remove it.
- New heading images: add them to `scripts/email-art.py` (needs `scripts/fonts/PressStart2P.ttf`), run it, and deploy the site so `pinball.lonecottonwood.com/email/*.png` exists **before** sending.

## Sending (Resend)
- Sender: `Woodside Pinball Open <pinball@lonecottonwood.com>`. The domain is verified at Resend, with DNS at Porkbun. Replies forward to mattgarr@gmail.com.
- Use the batch API, up to 100 messages per call. The key lives in Supabase function secrets as `RESEND_API_KEY`. Never type keys into sites; the user pastes them.
- Escape every user-provided string (`esc()`). Keep a plain no-marketing line in the footer.
