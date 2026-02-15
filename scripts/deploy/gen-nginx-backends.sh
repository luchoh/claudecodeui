#!/bin/bash
set -euo pipefail

# gen-nginx-backends.sh — Generate nginx backend map from backends.json
#
# Reads the backend registry and generates the nginx map block that routes
# the 'backend' cookie value to the correct chisel tunnel port.
#
# Usage:
#   gen-nginx-backends.sh [BACKENDS_JSON] [OUTPUT_CONF]
#
# Arguments:
#   BACKENDS_JSON  Path to backends registry (default: /etc/claudeui/backends.json)
#   OUTPUT_CONF    Path to nginx conf output (default: /etc/nginx/conf.d/claudeui-backends.conf)
#
# Examples:
#   gen-nginx-backends.sh
#   gen-nginx-backends.sh /etc/claudeui/backends.json /etc/nginx/conf.d/claudeui-backends.conf
#   gen-nginx-backends.sh ./test-backends.json ./test-output.conf

BACKENDS_JSON="${1:-/etc/claudeui/backends.json}"
OUTPUT_CONF="${2:-/etc/nginx/conf.d/claudeui-backends.conf}"

# Validate input file exists
if [[ ! -f "$BACKENDS_JSON" ]]; then
    echo "ERROR: backends registry not found: $BACKENDS_JSON" >&2
    exit 1
fi

# Validate JSON is parseable
if ! jq empty "$BACKENDS_JSON" 2>/dev/null; then
    echo "ERROR: invalid JSON in $BACKENDS_JSON" >&2
    exit 1
fi

# Validate there is at least one backend
BACKEND_COUNT=$(jq -r '.backends | length' "$BACKENDS_JSON")
if [[ "$BACKEND_COUNT" -eq 0 ]]; then
    echo "ERROR: no backends defined in $BACKENDS_JSON" >&2
    exit 1
fi

# Get the first backend's port for the default
DEFAULT_PORT=$(jq -r '.backends | to_entries | sort_by(.key) | .[0].value.port' "$BACKENDS_JSON")

# Generate the map block
{
    echo "# /etc/nginx/conf.d/claudeui-backends.conf"
    echo "# Auto-generated from $BACKENDS_JSON"
    echo "# Generated at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "# DO NOT EDIT — regenerate with: gen-nginx-backends.sh"
    echo ""
    echo "map \$cookie_backend \$backend_port {"
    echo "    default     ${DEFAULT_PORT};"

    # Sort by key for deterministic output
    jq -r '.backends | to_entries | sort_by(.key) | .[] | "    \(.key)  \(.value.port);"' "$BACKENDS_JSON"

    echo "}"
    echo ""
    echo "# Used in the main server block:"
    echo "# proxy_pass http://localhost:\$backend_port;"
} > "$OUTPUT_CONF"

echo "Generated $OUTPUT_CONF with $BACKEND_COUNT backends (default port: $DEFAULT_PORT)"

# Validate nginx configuration
if ! nginx -t 2>/dev/null; then
    echo "ERROR: nginx configuration test failed after generating $OUTPUT_CONF" >&2
    echo "Review the generated file and fix any issues before reloading nginx." >&2
    exit 1
fi

echo "Nginx configuration test passed. Reloading nginx..."
nginx -s reload

echo "Done. Nginx reloaded with updated backend map."