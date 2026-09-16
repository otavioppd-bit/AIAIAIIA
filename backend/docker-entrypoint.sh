#!/usr/bin/env sh
# Applies pending migrations before serving, so a deploy can never start
# against a schema older than the code it is running.
set -e

case "${DATABASE_URL:-}" in
  ""|sqlite*)
    echo "SQLite detected: tables are created on startup, skipping migrations."
    ;;
  *)
    echo "Applying database migrations…"
    alembic upgrade head
    ;;
esac

exec "$@"
