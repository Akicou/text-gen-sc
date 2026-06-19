#!/usr/bin/env bash
# Packages the Firefox add-ons as .xpi files and opens them for normal (persistent) installation.
# NOTE: Regular Firefox permanently installs only signed add-ons. If Firefox says the
# add-on is corrupt/unverified, sign the generated .xpi on AMO or use Firefox
# Developer Edition/Nightly/ESR with signature enforcement disabled.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT/build/firefox-addons"
mkdir -p "$OUT"

for addon in moodle-extractor classtime-extension; do
  xpi="$OUT/$addon.xpi"
  rm -f "$xpi"
  (cd "$ROOT/$addon" && zip -r "$xpi" . -x '*.DS_Store' >/dev/null)
  echo "Created $xpi"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$xpi" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$xpi"
  fi
done

echo
echo 'If Firefox accepts the install prompt, these add-ons are permanent and survive restarts.'
echo 'If Firefox blocks them as unsigned, sign the .xpi files on addons.mozilla.org or use Developer Edition/Nightly/ESR with xpinstall.signatures.required=false.'
