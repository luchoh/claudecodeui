#!/bin/bash
set -euo pipefail

# /usr/local/bin/aggregate-projects.sh (runs every 60s via systemd timer)
# Queries each online backend's /api/projects and writes a combined JSON file
BACKENDS_JSON="/etc/claudeui/backends.json"
OUTPUT="/var/www/claudeui/dist/backends-projects.json"
RESULT='{"backends":{}}'

for key in $(jq -r '.backends | keys[]' "$BACKENDS_JSON"); do
  port=$(jq -r ".backends[\"$key\"].port" "$BACKENDS_JSON")
  name=$(jq -r ".backends[\"$key\"].name" "$BACKENDS_JSON")
  # Skip unreachable backends
  if nc -z -w 2 localhost "$port" 2>/dev/null; then
    raw=$(curl -sf --max-time 5 "http://localhost:$port/api/projects" || echo '[]')
    # Validate JSON before using --argjson (invalid response must not abort the loop)
    if echo "$raw" | jq empty 2>/dev/null; then
      projects="$raw"
    else
      echo "WARN: invalid JSON from backend $key (port $port), using empty array" >&2
      projects='[]'
    fi
    RESULT=$(echo "$RESULT" | jq --arg k "$key" --arg n "$name" --argjson p "$projects" \
      '.backends[$k] = {"name": $n, "online": true, "projects": $p}')
  else
    RESULT=$(echo "$RESULT" | jq --arg k "$key" --arg n "$name" \
      '.backends[$k] = {"name": $n, "online": false, "projects": []}')
  fi
done

echo "$RESULT" > "$OUTPUT"
