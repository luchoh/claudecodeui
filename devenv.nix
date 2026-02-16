{ pkgs, lib, config, inputs, ... }:

{
  # Workaround for devenv bug #2405: secretspec module regression
  # https://github.com/cachix/devenv/issues/2405
  # Remove once upstream is fixed
  disabledModules = [ "${inputs.devenv}/integrations/secretspec.nix" ];

  packages = with pkgs; [
    nodejs_22
    jq
    git
    openssl  # For generating JWT_SECRET: openssl rand -base64 32
    mitmproxy
    chisel   # jpillora/chisel — reverse tunnel to EC2 (mTLS + auth)
  ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
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

      if [ "''${MITM_PROXY_ENABLE:-0}" = "1" ]; then
        proxy_url="''${MITM_PROXY_URL:-http://127.0.0.1:''${MITM_PROXY_PORT:-8082}}"
        export HTTP_PROXY="$proxy_url"
        export HTTPS_PROXY="$proxy_url"
        export NO_PROXY="127.0.0.1,localhost''${NO_PROXY:+,$NO_PROXY}"
        if [ -n "''${MITM_PROXY_CA_CERT:-}" ] && [ -f "''${MITM_PROXY_CA_CERT}" ]; then
          export NODE_EXTRA_CA_CERTS="''${MITM_PROXY_CA_CERT}"
        elif [ -f "$DEVENV_ROOT/.devenv/mitmproxy/mitmproxy-ca-cert.pem" ]; then
          export NODE_EXTRA_CA_CERTS="$DEVENV_ROOT/.devenv/mitmproxy/mitmproxy-ca-cert.pem"
        fi
        echo "MITM proxy enabled for client: $proxy_url"
      fi

      if [ "''${MITM_PROXY_ENABLE:-0}" = "1" ]; then
        proxy_url="''${MITM_PROXY_URL:-http://127.0.0.1:''${MITM_PROXY_PORT:-8082}}"
        export HTTP_PROXY="$proxy_url"
        export HTTPS_PROXY="$proxy_url"
        export NO_PROXY="127.0.0.1,localhost''${NO_PROXY:+,$NO_PROXY}"
        if [ -n "''${MITM_PROXY_CA_CERT:-}" ] && [ -f "''${MITM_PROXY_CA_CERT}" ]; then
          export NODE_EXTRA_CA_CERTS="''${MITM_PROXY_CA_CERT}"
        elif [ -f "$DEVENV_ROOT/.devenv/mitmproxy/mitmproxy-ca-cert.pem" ]; then
          export NODE_EXTRA_CA_CERTS="$DEVENV_ROOT/.devenv/mitmproxy/mitmproxy-ca-cert.pem"
        fi
        echo "MITM proxy enabled for server: $proxy_url"
      fi

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

      export CHOKIDAR_USEPOLLING=0
      export CHOKIDAR_PRINT_FSEVENTS_REQUIRE_ERROR=1
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

  processes.mitmproxy.exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"

    conf_dir="$DEVENV_ROOT/.devenv/mitmproxy"
    flow_file="/tmp/claudecodeui-security-audit/mitmproxy-live.flow"
    log_file="/tmp/claudecodeui-security-audit/mitmproxy-live.log"
    port="''${MITM_PROXY_PORT:-8082}"

    mkdir -p "$conf_dir" /tmp/claudecodeui-security-audit

    echo "Starting mitmdump on 127.0.0.1:$port"
    echo "Flows: $flow_file"
    echo "Log: $log_file"
    echo "CA cert: $conf_dir/mitmproxy-ca-cert.pem"

    exec mitmdump --listen-host 127.0.0.1 --listen-port "$port" \
      --set confdir="$conf_dir" \
      -w "$flow_file" > "$log_file" 2>&1
  '';

  processes.tunnel.exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"

    # Require .env.dev for CHISEL_AUTH
    if [ ! -f .env.dev ]; then
      echo "ERROR: .env.dev not found. Run: cp .env.dev.example .env.dev"
      exit 1
    fi

    set -a
    source .env.dev
    set +a

    if [ -z "''${CHISEL_AUTH:-}" ]; then
      echo "════════════════════════════════════════════════════════════════"
      echo "ERROR: CHISEL_AUTH not set in .env.dev"
      echo "════════════════════════════════════════════════════════════════"
      echo ""
      echo "Retrieve it with:"
      echo "  aws secretsmanager get-secret-value --secret-id claudeui/chisel-auth \\"
      echo "    --query SecretString --output text --region us-west-2 --profile sl-admin"
      echo ""
      echo "Then add to .env.dev:  CHISEL_AUTH=<value>"
      echo ""
      exit 1
    fi

    cert_dir="$DEVENV_ROOT/.chisel"
    for f in ca.crt client.crt client.key; do
      if [ ! -f "$cert_dir/$f" ]; then
        echo "════════════════════════════════════════════════════════════════"
        echo "ERROR: Missing $cert_dir/$f"
        echo "════════════════════════════════════════════════════════════════"
        echo ""
        echo "mTLS client certs are per-developer. Generate yours:"
        echo ""
        echo "  1. Retrieve the CA cert + key:"
        echo "     aws secretsmanager get-secret-value --secret-id claudeui/mtls-ca-cert \\"
        echo "       --query SecretString --output text --region us-west-2 --profile sl-admin > .chisel/ca.crt"
        echo "     aws secretsmanager get-secret-value --secret-id claudeui-ca/mtls-ca-key \\"
        echo "       --query SecretString --output text --region us-west-2 --profile sl-admin > /tmp/ca.key"
        echo ""
        echo "  2. Generate client cert:"
        echo "     openssl req -new -newkey rsa:2048 -nodes -keyout .chisel/client.key \\"
        echo "       -out /tmp/client.csr -subj '/CN=$(whoami)-client'"
        echo "     openssl x509 -req -in /tmp/client.csr -CA .chisel/ca.crt -CAkey /tmp/ca.key \\"
        echo "       -CAcreateserial -out .chisel/client.crt -days 365 -sha256"
        echo "     rm -f /tmp/client.csr /tmp/ca.key /tmp/ca.srl"
        echo ""
        exit 1
      fi
    done

    tunnel_host="''${TUNNEL_HOST:-tunnel.agents.superlinear.com}"
    tunnel_port="''${TUNNEL_PORT:-8443}"
    remote_port="''${TUNNEL_REMOTE_PORT:-9001}"
    local_port="''${PORT:-3001}"

    echo "Connecting tunnel: localhost:$local_port -> $tunnel_host port $remote_port"
    echo "Endpoint: https://$tunnel_host:$tunnel_port"

    exec chisel client \
      --auth "$CHISEL_AUTH" \
      --tls-ca "$cert_dir/ca.crt" \
      --tls-cert "$cert_dir/client.crt" \
      --tls-key "$cert_dir/client.key" \
      "https://$tunnel_host:$tunnel_port" \
      "R:$remote_port:localhost:$local_port"
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
    else
      # Check if native modules need rebuild (Node version mismatch)
      current_node=$(node --version | cut -d. -f1 | tr -d 'v')
      if [ -f node_modules/.node_version ]; then
        built_node=$(cat node_modules/.node_version)
        if [ "$current_node" != "$built_node" ]; then
          echo "🔄 Node version changed ($built_node -> $current_node), rebuilding native modules..."
          npm rebuild better-sqlite3 2>/dev/null || true
          echo "$current_node" > node_modules/.node_version
        fi
      else
        echo "$current_node" > node_modules/.node_version
      fi
    fi

    # Check tunnel readiness
    if [ -z "''${CHISEL_AUTH:-}" ]; then
      echo "⚠️  CHISEL_AUTH not set (tunnel won't connect)"
    elif [ ! -f .chisel/client.crt ]; then
      echo "⚠️  .chisel/client.crt missing (run 'devenv up tunnel' for setup instructions)"
    else
      echo "✅ Tunnel configured (port ''${PORT:-3001} → ''${TUNNEL_HOST:-tunnel.agents.superlinear.com}:''${TUNNEL_REMOTE_PORT:-9001})"
    fi
    echo ""

    echo "Commands:"
    echo "  devenv up                # run server + client + tunnel together"
    echo "  devenv up server         # run Express backend only (port ''${PORT:-3001})"
    echo "  devenv up client         # run Vite dev server only (port ''${VITE_PORT:-5173})"
    echo "  devenv up tunnel         # run chisel reverse tunnel to EC2"
    echo "  devenv up mitmproxy      # run mitmdump on 127.0.0.1:''${MITM_PROXY_PORT:-8082}"
    echo "  npm run build            # build for production"
    echo "  npm run typecheck        # run TypeScript type checking"
    echo ""
  '';
}
