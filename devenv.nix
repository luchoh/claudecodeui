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
    openssl  # For generating JWT_SECRET: openssl rand -base64 32
  ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_20;
  };

  scripts = {
    "npm-install".exec = "npm install";
    "npm-build".exec = "npm run build";
    "npm-lint".exec = "npm run typecheck";
    "generate-secret".exec = ''
      secret=$(openssl rand -base64 32)
      echo "Generated JWT_SECRET:"
      echo ""
      echo "JWT_SECRET=$secret"
      echo ""
      echo "Add this to your .env.dev file"
    '';
    "setup-env".exec = ''
      if [ -f .env.dev ]; then
        echo ".env.dev already exists. Remove it first if you want to regenerate."
        exit 1
      fi
      cp .env.dev.example .env.dev
      secret=$(openssl rand -base64 32)
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i "" "s/^JWT_SECRET=.*/JWT_SECRET=$secret/" .env.dev
      else
        sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$secret/" .env.dev
      fi
      echo "Created .env.dev with generated JWT_SECRET"
      echo "Review and customize other settings as needed."
    '';
  };

  processes.server.exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"

    # Fail fast if profile not set up
    if [ ! -f .env.dev ]; then
      echo "════════════════════════════════════════════════════════════════"
      echo "ERROR: .env.dev not found!"
      echo "════════════════════════════════════════════════════════════════"
      echo ""
      echo "Setup instructions:"
      echo "  1. cp .env.dev.example .env.dev"
      echo "  2. Generate JWT_SECRET: openssl rand -base64 32"
      echo "  3. Add the secret to .env.dev"
      echo ""
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

      # Validate PORT
      if [ -z "$PORT" ] || ! printf '%s' "$PORT" | grep -Eq '^[0-9]+$'; then
        echo "PORT must be numeric" >&2
        exit 1
      fi

      # SEC-001: Validate JWT_SECRET (must be 32+ chars)
      if [ -z "''${JWT_SECRET:-}" ]; then
        echo "════════════════════════════════════════════════════════════════"
        echo "ERROR: JWT_SECRET is required in .env.dev"
        echo "════════════════════════════════════════════════════════════════"
        echo ""
        echo "Generate one with: openssl rand -base64 32"
        echo "Then add it to .env.dev:"
        echo "  JWT_SECRET=your-generated-secret-here"
        echo ""
        exit 1
      fi

      jwt_len=''${#JWT_SECRET}
      if [ "$jwt_len" -lt 32 ]; then
        echo "════════════════════════════════════════════════════════════════"
        echo "ERROR: JWT_SECRET must be at least 32 characters (current: $jwt_len)"
        echo "════════════════════════════════════════════════════════════════"
        echo ""
        echo "Generate a proper secret: openssl rand -base64 32"
        echo ""
        exit 1
      fi

      echo "Starting backend server on PORT=$PORT (BIND_HOST=''${BIND_HOST:-127.0.0.1})"

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
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo "  Claude Code UI - Development Shell"
    echo "════════════════════════════════════════════════════════════════"
    echo ""

    # Check for .env.dev setup
    if [ ! -f .env.dev ]; then
      echo "⚠️  First-time setup required:"
      echo ""
      echo "  1. Copy example config:  cp .env.dev.example .env.dev"
      echo "  2. Generate JWT secret:  openssl rand -base64 32"
      echo "  3. Add secret to .env.dev: JWT_SECRET=<your-secret>"
      echo ""
    else
      # Source .env.dev to show config
      set -a
      source .env.dev 2>/dev/null || true
      set +a

      echo "📁 PORT=''${PORT:-3001}"
      echo "📁 VITE_PORT=''${VITE_PORT:-5173}"
      echo "📁 BIND_HOST=''${BIND_HOST:-127.0.0.1}"

      if [ -z "''${JWT_SECRET:-}" ]; then
        echo "⚠️  JWT_SECRET not set in .env.dev"
        echo "   Generate with: openssl rand -base64 32"
      else
        jwt_len=''${#JWT_SECRET}
        if [ "$jwt_len" -lt 32 ]; then
          echo "⚠️  JWT_SECRET too short ($jwt_len chars, need 32+)"
        else
          echo "✅ JWT_SECRET configured ($jwt_len chars)"
        fi
      fi
      echo ""
    fi

    # Install dependencies if needed
    if [ ! -d node_modules ]; then
      echo "📦 Installing dependencies..."
      npm install
    fi

    echo "Commands:"
    echo "  devenv up                # run server + client together"
    echo "  devenv up server         # run Express backend only (port ''${PORT:-3001})"
    echo "  devenv up client         # run Vite dev server only (port ''${VITE_PORT:-5173})"
    echo "  npm run build            # build for production"
    echo "  npm run typecheck        # run TypeScript type checking"
    echo ""
  '';
}
