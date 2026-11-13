#!/usr/bin/env bash
# Elküldi az összes teszt e-mailt a workflow webhookjára.
# Használat: ./send_test.sh            -> production URL (aktív workflow)
#            ./send_test.sh test       -> test URL (n8n editorban "Listen for test event")
set -euo pipefail
BASE="${N8N_URL:-http://localhost:5678}"
PATH_PREFIX="webhook"; [[ "${1:-}" == "test" ]] && PATH_PREFIX="webhook-test"
for f in "$(dirname "$0")"/test-emails/*.json; do
  echo "== $(basename "$f")"
  curl -sS -X POST "$BASE/$PATH_PREFIX/support-email" -H 'Content-Type: application/json' --data @"$f"
  echo; echo
done
