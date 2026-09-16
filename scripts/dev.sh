#!/usr/bin/env bash
# Local development runner: starts the API and the web app together.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

start_api() {
  cd "$ROOT/backend"
  [ -d .venv ] || python3 -m venv .venv
  ./.venv/bin/pip install -q -r requirements.txt
  ./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
}

start_web() {
  cd "$ROOT/frontend"
  [ -d node_modules ] || npm install
  npm run dev
}

case "${1:-all}" in
  api) start_api ;;
  web) start_web ;;
  *)
    start_api & API_PID=$!
    start_web & WEB_PID=$!
    trap 'kill $API_PID $WEB_PID 2>/dev/null || true' EXIT INT TERM
    wait
    ;;
esac
