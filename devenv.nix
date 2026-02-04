{ pkgs, lib, config, inputs, ... }:

{
  # Workaround for devenv bug #2405: secretspec module regression
  # https://github.com/cachix/devenv/issues/2405
  # Remove once upstream is fixed
  disabledModules = [ "${inputs.devenv}/integrations/secretspec.nix" ];

  dotenv.enable = true;

  packages = with pkgs; [
    nodejs_20
    jq
    git
  ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_20;
  };

  scripts = {
    "npm-install".exec = "npm install";
    "npm-build".exec = "npm run build";
    "npm-lint".exec = "npm run typecheck";
  };

  processes.server.exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"

    # Fail fast if profile not set up
    if [ ! -f .env.dev ]; then
      echo "ERROR: .env.dev not found!"
      echo "Run: cp .env.dev.example .env.dev"
      echo "Then fill in your secrets."
      exit 1
    fi

    server_pid=

    kill_tree() {
      pid="$1"
      if [ -z "$pid" ]; then
        return
      fi
      if command -v pgrep >/dev/null 2>&1; then
        for child in $(pgrep -P "$pid" 2>/dev/null); do
          kill_tree "$child"
        done
      fi
      kill "$pid" 2>/dev/null || true
    }

    cleanup() {
      if [ -n "''${server_pid}" ]; then
        kill_tree "''${server_pid}"
      fi
    }

    trap cleanup INT TERM EXIT

    # Run in subshell to prevent variable leakage between processes
    (
      set -a
      source .env.dev
      set +a

      if [ -z "$PORT" ] || ! printf '%s' "$PORT" | grep -Eq '^[0-9]+$'; then
        echo "PORT must be numeric" >&2
        exit 1
      fi

      echo "Starting backend server on PORT=$PORT"

      exec node server/index.js
    ) &
    server_pid=$!

    wait "''${server_pid}"
    status=$?
    if [ "$status" -eq 143 ] || [ "$status" -eq 130 ]; then
      exit 0
    fi
    exit "$status"
  '';

  processes.client.exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"

    # Fail fast if profile not set up
    if [ ! -f .env.dev ]; then
      echo "ERROR: .env.dev not found!"
      echo "Run: cp .env.dev.example .env.dev"
      echo "Then fill in your secrets."
      exit 1
    fi

    client_pid=

    kill_tree() {
      pid="$1"
      if [ -z "$pid" ]; then
        return
      fi
      if command -v pgrep >/dev/null 2>&1; then
        for child in $(pgrep -P "$pid" 2>/dev/null); do
          kill_tree "$child"
        done
      fi
      kill "$pid" 2>/dev/null || true
    }

    cleanup() {
      if [ -n "''${client_pid}" ]; then
        kill_tree "''${client_pid}"
      fi
    }

    trap cleanup INT TERM EXIT

    # Run in subshell to prevent variable leakage between processes
    (
      set -a
      source .env.dev
      set +a

      if [ -z "$VITE_PORT" ] || ! printf '%s' "$VITE_PORT" | grep -Eq '^[0-9]+$'; then
        echo "VITE_PORT must be numeric" >&2
        exit 1
      fi

      echo "Starting Vite dev server on VITE_PORT=$VITE_PORT"

      exec npm run client
    ) &
    client_pid=$!

    wait "''${client_pid}"
    status=$?
    if [ "$status" -eq 143 ] || [ "$status" -eq 130 ]; then
      exit 0
    fi
    exit "$status"
  '';

  enterShell = ''
    echo "Claude Code UI development shell"
    echo "PORT=$PORT"
    echo "VITE_PORT=$VITE_PORT"
    if [ ! -d node_modules ]; then
      npm install
    fi
    echo ""
    echo "Useful commands:"
    echo "  devenv shell             # enter this shell again"
    echo "  devenv up server         # run Express backend (port $PORT)"
    echo "  devenv up client         # run Vite dev server (port $VITE_PORT)"
    echo "  devenv up server client  # run both processes together"
    echo "  npm run dev              # run both with concurrently"
    echo "  npm run build            # build for production"
    echo "  npm run typecheck        # run TypeScript type checking"
  '';
}
