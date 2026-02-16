#!/bin/bash
set -euo pipefail

# /usr/local/bin/check-tunnels.sh
BACKENDS_JSON="/etc/claudeui/backends.json"
PORTS=$(jq -r '.backends[].port' "$BACKENDS_JSON")

for port in $PORTS; do
  if ! nc -z -w 2 localhost $port 2>/dev/null; then
    echo "$(date) WARN: tunnel port $port unreachable" >> /var/log/chisel/health.log
  fi
done
