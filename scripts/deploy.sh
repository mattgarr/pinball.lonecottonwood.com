#!/usr/bin/env bash
# Build the site and publish it to the gh-pages branch (GitHub Pages serves that branch).
set -euo pipefail
REPO="git@github.com:mattgarr/pinball.lonecottonwood.com.git"
cd "$(dirname "$0")/../web"
npm run build
cd dist
# GitHub Pages serves unknown paths through 404.html (the app still loads, but with a 404 status, which
# some link previews and in-app browsers treat as broken). Publish a real copy of the app at every
# route instead, as both route.html and route/index.html (Pages may redirect to the trailing slash).
for r in join rejoin me ranks about register tv lights-sim host host/guests host/qr host/test host/calibrate \
         machine/1 machine/2 machine/3 machine/4 machine/5 machine/6 \
         machine/1/guide machine/2/guide machine/3/guide machine/4/guide machine/5/guide machine/6/guide; do
  mkdir -p "$r" "$(dirname "$r")"
  cp index.html "$r.html"
  cp index.html "$r/index.html"
done
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -qm "Deploy $(date '+%Y-%m-%d %H:%M')"
# SSH first; if the SSH agent is locked or unavailable, fall back to HTTPS with the GitHub CLI login.
if ! git push -qf "$REPO" gh-pages 2>/dev/null; then
  echo "SSH push failed; retrying over HTTPS with gh auth…"
  git -c credential.helper= -c credential.helper='!gh auth git-credential' push -qf "https://github.com/mattgarr/pinball.lonecottonwood.com.git" gh-pages
fi
rm -rf .git
echo "Deployed. Live at https://pinball.lonecottonwood.com in about a minute."
