#!/usr/bin/env bash
set -euo pipefail

EXPECTED=$(flask --app app:create_app db heads 2>/dev/null | awk '{print $1}')
CURRENT=$(flask --app app:create_app db current 2>/dev/null | awk '{print $1}')

if [ "$EXPECTED" != "$CURRENT" ]; then
  echo "ERROR: DB at $CURRENT, expected $EXPECTED. Run: flask --app app:create_app db upgrade"
  exit 1
fi

echo "DB schema OK: $CURRENT"
