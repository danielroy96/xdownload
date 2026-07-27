#!/usr/bin/env bash
#
# xDownload E2E orchestrator.
# ---------------------------
# Runs the end-to-end suite against the PRODUCTION Worker + app.
#
#   ./run.sh              # worker/HTTP layer (default) — zero deps, always runs
#   ./run.sh browser      # full-journey browser layer only (installs Playwright)
#   ./run.sh all          # both layers
#
# Override the target (e.g. a preview deploy) with BASE:
#   BASE=https://staging.example.workers.dev ./run.sh all
#
# The worker layer needs nothing but Node (uses the built-in test runner +
# fetch), matching the repo's dep-free ethos. The browser layer installs
# Playwright into THIS skill's own node_modules so the repo stays untouched.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${BASE:-https://xdownload.info}"
LAYER="${1:-worker}"
export BASE

echo "▶ xDownload E2E  —  target: $BASE  —  layer: $LAYER"
echo

run_worker() {
  echo "── Worker + integration (node --test) ─────────────────────────────"
  node --test "$HERE/tests/worker.e2e.mjs"
}

run_browser() {
  echo "── Full-journey browser (Playwright) ──────────────────────────────"
  if ! command -v npx >/dev/null 2>&1; then
    echo "✖ npx not found — install Node.js to run the browser layer." >&2
    return 1
  fi
  cd "$HERE"
  # Local, throwaway install — keeps the repo dependency-free.
  if [ ! -d node_modules/@playwright/test ]; then
    echo "Installing Playwright (one-time, into $HERE/node_modules)…"
    npm install --no-save --prefix "$HERE" @playwright/test >/dev/null 2>&1
    npx --prefix "$HERE" playwright install chromium
  fi
  npx --prefix "$HERE" playwright test --config "$HERE/tests/playwright.config.mjs"
}

case "$LAYER" in
  worker)  run_worker ;;
  browser) run_browser ;;
  all)     run_worker; echo; run_browser ;;
  *) echo "Unknown layer '$LAYER'. Use: worker | browser | all" >&2; exit 2 ;;
esac
