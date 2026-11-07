---
name: ipdb-backglass
description: Download real backglass/translite images for a pinball machine (IPDB or manufacturer sites) and wire them into Pinball Wizard's machine art. Use when adding or replacing machine artwork in web/public/machines.
---

# Backglass art → Pinball Wizard

## What works (learned 2026-11-07)
- **IPDB (ipdb.org) blocks plain curl and the built-in browser pane with a Cloudflare bot check.** Never try to get around it.
- **The user's own Chrome is logged in to IPDB and passes fine.** Use the Claude in Chrome tools (`mcp__claude-in-chrome__*`) in a new tab.
- The Chrome extension blocks large base64 output from JavaScript, and pages can't POST to localhost. **Use real browser downloads instead.**
  - Fetch the image from the page (same origin) and click an `<a download>`:
    ```js
    const r = await fetch('/images/<ipdbId>/<file>.jpg'); const b = await r.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'pw-<slug>.jpg';
    document.body.appendChild(a); a.click(); `${r.status} ${b.size}`
    ```
  - Files land in `~/Downloads/pw-<slug>.jpg`. Check with `ls ~/Downloads/pw-*.jpg`.
  - **Chrome allows only one automatic download per site** until the user allows "multiple downloads" for ipdb.org (the address-bar icon, or `chrome://settings/content/automaticDownloads`). That's a browser setting, so ask the user to flip it. Don't change it yourself.
- **Most reliable method, no downloads needed: full-resolution capture.** Navigate the Chrome tab straight to the image URL (`https://www.ipdb.org/images/<id>/<file>.jpg`), get the image's on-screen box with
  `const i=document.images[0],r=i.getBoundingClientRect(),k=1440/innerWidth; [r.x*k,r.y*k,(r.x+r.width)*k,(r.y+r.height)*k]`
  (1440 = the screenshot frame width; check what the screenshot reports), then
  `computer zoom` with that region, `save_to_disk: true`, and **scale 1** (the saved file uses the scale you pass).
  It saves a PNG of about 1300px under the session's `tool-results/` folder; convert with `sips -s format jpeg`. This is how Fathom, Whirlwind, White Water and Cactus Canyon were done.
- The same capture works for Google Images previews, e.g. test photos for the score reader.
- **Dungeons & Dragons (Stern 2025):** not on IPDB. Use sternpinball.com's game page. The Premium/LE backglass (beholder) is the one this party's machine uses.

## Known-good IPDB images
| slug | IPDB id | file | notes |
|---|---|---|---|
| centaur | 476 | image-18.jpg | 965×913, lit gold glass (done) |
| fathom | 829 | image-A18.jpg | 1024×768 |
| whirlwind | 2765 | image-5.jpg | 1024×689 translite |
| white-water | 2768 | image-48.jpg | 1024×681 translite |
| cactus-canyon | 4445 | image-5.jpg | 1024×753 (Backglass.jpg = cleaner 702×486) |

## Process each image
1. Open it with the Read tool and check visually that it's the right machine's backglass.
2. Re-encode at its native size (never upscale) into the app:
   `sips -s format jpeg -s formatOptions 82 ~/Downloads/pw-<slug>.jpg --out web/public/machines/<slug>.jpg`
   (add `-Z 1400` only if the long side is over 1400).
3. Add the slug to `PHOTO_SLUGS` in `web/src/lib/machineArt.js`.
4. Add a row to `web/public/machines/CREDITS.md` with the source URL. The art is © the manufacturer, used here for a private party.
5. Build-check: `cd web && npx vite build --outDir /tmp/pw-check --emptyOutDir`.
