#!/bin/bash
# Installs the Garage Lights Listener: a background app (no Dock icon) that runs scripts/music-sync.mjs
# at login and restarts it if it stops. Safe to run again (it keeps the app, and so its permission,
# unless something it's built from changed).
#   bash scripts/listener/install.sh            install / update and start
#   bash scripts/listener/install.sh --remove   stop it and remove it
set -euo pipefail
LABEL=com.lonecottonwood.garage-lights-listener
APP="$HOME/Applications/Garage Lights Listener.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/Garage Lights Listener.log"
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then rm -rf "$APP" "$PLIST"; echo "Removed. (The lights use the controller mic.)"; exit 0; fi

NODE="$(command -v node)"; SCRIPT="$REPO/scripts/music-sync.mjs"
[ -x "$NODE" ] || { echo "node not found"; exit 1; }
# The system-audio permission belongs to this exact build, so only rebuild when an input changed.
ID="$(printf '%s\n%s\n' "$NODE" "$SCRIPT" | cat - "$HERE/launcher.c" "$HERE/install.sh" | shasum | cut -c1-16)"
if [ "$(cat "$APP/Contents/Resources/build-id" 2>/dev/null)" != "$ID" ]; then
  echo "Building the app…"
  rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  clang -O2 -DNODE="\"$NODE\"" -DSCRIPT="\"$SCRIPT\"" -o "$APP/Contents/MacOS/GarageLightsListener" "$HERE/launcher.c"
  cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>$LABEL</string>
  <key>CFBundleName</key><string>Garage Lights Listener</string>
  <key>CFBundleExecutable</key><string>GarageLightsListener</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>14.2</string>
  <key>NSAudioCaptureUsageDescription</key><string>Hears the music this Mac plays so the garage lights can follow the beat.</string>
</dict></plist>
PL
  echo "$ID" > "$APP/Contents/Resources/build-id"
  codesign --force --sign - --identifier "$LABEL" "$APP"
  NEW=1
fi
# The audio tap the listener uses (built here so nothing needs building at login).
clang -fobjc-arc -framework CoreAudio -framework Foundation -o "$REPO/scripts/systap" "$REPO/scripts/systap.m" 2>/dev/null \
  || [ -x "$REPO/scripts/systap" ]
[ "$REPO/scripts/systap" -nt "$REPO/scripts/systap.m" ] || touch "$REPO/scripts/systap"

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$APP/Contents/MacOS/GarageLightsListener</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Garage Lights Listener is running and will start at every login. Log: $LOG"
[ "${NEW:-}" = 1 ] && echo "First time: pick \"Laptop sound\" on the host lights card; if macOS doesn't ask to allow system audio recording, add the app in System Settings → Privacy & Security → Screen & System Audio Recording (System Audio Recording Only)."
exit 0
