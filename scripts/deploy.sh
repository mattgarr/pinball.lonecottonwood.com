#!/usr/bin/env bash
# Build the site and publish it to the gh-pages branch (GitHub Pages serves that branch).
set -euo pipefail
REPO="git@github.com:mattgarr/pinball.lonecottonwood.com.git"
cd "$(dirname "$0")/../web"
npm run build
cd dist
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
