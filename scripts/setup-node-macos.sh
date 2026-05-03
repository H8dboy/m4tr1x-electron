#!/usr/bin/env bash
# M4TR1X — macOS Node Setup
# Run from the project root: bash scripts/setup-node-macos.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== M4TR1X Node Setup (macOS) ==="
echo "Project: $ROOT"

# ─── 1. Tor hidden service ────────────────────────────────────────────────────
echo ""
echo "[1/6] Configuring Tor hidden service..."

TORRC=""
for p in /opt/homebrew/etc/tor/torrc /usr/local/etc/tor/torrc; do
  if [ -f "$p" ]; then TORRC="$p"; break; fi
done

if [ -z "$TORRC" ]; then
  echo "    torrc not found. Installing tor via Homebrew..."
  brew install tor
  TORRC="/opt/homebrew/etc/tor/torrc"
  [ -f "$TORRC" ] || TORRC="/usr/local/etc/tor/torrc"
fi

echo "    torrc: $TORRC"

HS_DIR="$(brew --prefix)/var/lib/tor/m4tr1x"
mkdir -p "$HS_DIR"

if ! grep -q "m4tr1x" "$TORRC" 2>/dev/null; then
  cat >> "$TORRC" << EOF

# M4TR1X Node — Hidden Service
HiddenServiceDir $HS_DIR
HiddenServicePort 80 127.0.0.1:8080
HiddenServicePort 4848 127.0.0.1:4848
EOF
  echo "    Hidden service config added."
else
  echo "    Hidden service already configured."
fi

# Restart Tor
if brew services list | grep -q "tor.*started"; then
  brew services restart tor
else
  brew services start tor
fi

echo "    Waiting for .onion address..."
for i in $(seq 1 20); do
  sleep 1
  if [ -f "$HS_DIR/hostname" ]; then break; fi
done

ONION=$(cat "$HS_DIR/hostname" 2>/dev/null || echo "")
if [ -z "$ONION" ]; then
  echo "    WARNING: .onion address not generated yet. Tor may still be starting."
  echo "    Run: cat $HS_DIR/hostname  (after a few seconds)"
else
  echo "    .onion: $ONION"
fi

# ─── 2. Update .env ───────────────────────────────────────────────────────────
echo ""
echo "[2/6] Updating .env..."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "    Created .env from .env.example"
fi

# Generate keys if missing
if ! grep -q "^ADMIN_KEY=.\+" .env 2>/dev/null; then
  AK=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  AS=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i '' "s/^ADMIN_KEY=.*/ADMIN_KEY=$AK/" .env 2>/dev/null || echo "ADMIN_KEY=$AK" >> .env
  sed -i '' "s/^APP_SECRET=.*/APP_SECRET=$AS/" .env 2>/dev/null || echo "APP_SECRET=$AS" >> .env
  echo "    Generated ADMIN_KEY and APP_SECRET"
fi

# Set PRIVATE_NODE_URL to .onion if available
if [ -n "$ONION" ]; then
  if grep -q "^PRIVATE_NODE_URL=" .env; then
    sed -i '' "s|^PRIVATE_NODE_URL=.*|PRIVATE_NODE_URL=http://$ONION|" .env
  else
    echo "PRIVATE_NODE_URL=http://$ONION" >> .env
  fi
  # Also expose onion for node_manager
  if grep -q "^PUBLIC_NODE_URL=" .env; then
    sed -i '' "s|^PUBLIC_NODE_URL=.*|PUBLIC_NODE_URL=http://$ONION|" .env
  else
    echo "PUBLIC_NODE_URL=http://$ONION" >> .env
  fi
  echo "    PRIVATE_NODE_URL and PUBLIC_NODE_URL set to http://$ONION"
fi

# Save onion hostname where node_manager can read it
DATA_DIR="$HOME/.config/m4tr1x"
mkdir -p "$DATA_DIR"
if [ -n "$ONION" ]; then
  echo "$ONION" > "$DATA_DIR/onion_hostname"
  echo "    Hostname saved to $DATA_DIR/onion_hostname"
fi

# ─── 3. Server deps ───────────────────────────────────────────────────────────
echo ""
echo "[3/6] Installing dependencies..."
npm install --silent
cd server && npm install --silent && cd ..
echo "    Dependencies OK"

# ─── 4. Upload limits ─────────────────────────────────────────────────────────
echo ""
echo "[4/6] Checking upload limits..."

if grep -q "^MAX_FILE_SIZE_MB=" .env; then
  CUR=$(grep "^MAX_FILE_SIZE_MB=" .env | cut -d= -f2)
  if [ "$CUR" -lt 500 ] 2>/dev/null; then
    sed -i '' "s/^MAX_FILE_SIZE_MB=.*/MAX_FILE_SIZE_MB=500/" .env
    echo "    MAX_FILE_SIZE_MB updated: $CUR → 500"
  else
    echo "    MAX_FILE_SIZE_MB=$CUR (OK)"
  fi
else
  echo "MAX_FILE_SIZE_MB=500" >> .env
  echo "    MAX_FILE_SIZE_MB=500 added"
fi

UPLOADS="$HOME/.config/m4tr1x/uploads"
mkdir -p "$UPLOADS"
FREE=$(df -g "$UPLOADS" 2>/dev/null | awk 'NR==2{print $4}')
echo "    Uploads dir: $UPLOADS"
echo "    Free space: ${FREE}GB"

# ─── 5. pm2 ──────────────────────────────────────────────────────────────────
echo ""
echo "[5/6] Configuring pm2..."

if ! command -v pm2 &>/dev/null; then
  npm install -g pm2 --silent
  echo "    pm2 installed"
fi

# Stop old instance if running
pm2 delete m4tr1x-node 2>/dev/null || true

# Create ecosystem file
cat > ecosystem.config.js << 'ECOS'
module.exports = {
  apps: [{
    name:        'm4tr1x-node',
    script:      'server/index.js',
    cwd:         __dirname,
    interpreter: 'node',
    env: {
      NODE_ENV: 'production',
    },
    env_file:    '.env',
    watch:       false,
    max_memory_restart: '512M',
    restart_delay: 3000,
    log_file:    `${process.env.HOME}/.config/m4tr1x/logs/m4tr1x.log`,
    error_file:  `${process.env.HOME}/.config/m4tr1x/logs/m4tr1x-error.log`,
    out_file:    `${process.env.HOME}/.config/m4tr1x/logs/m4tr1x-out.log`,
    merge_logs:  true,
  }],
}
ECOS

mkdir -p "$HOME/.config/m4tr1x/logs"

pm2 start ecosystem.config.js
pm2 save

# Setup startup (macOS LaunchAgent via pm2)
PM2_STARTUP=$(pm2 startup launchagent --no-daemon 2>&1 | grep "sudo env" || true)
if [ -n "$PM2_STARTUP" ]; then
  echo "    Run this to enable auto-start on reboot:"
  echo "    $PM2_STARTUP"
else
  pm2 startup 2>/dev/null || true
fi

echo "    pm2 configured"

# ─── 6. Declare node ──────────────────────────────────────────────────────────
echo ""
echo "[6/6] Declaring node on M4TR1X network..."
sleep 3

# Generate/load Nostr keys and declare node
node - << 'JSEOF'
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args)).catch(() => require('undici').fetch(...args))
async function main() {
  const base = 'http://localhost:8080'
  // Generate keys
  const k = await fetch(`${base}/api/v1/nostr/keys`, {method:'POST'}).then(r=>r.json()).catch(()=>null)
  if (!k) { console.log('Server not ready yet — run: pm2 logs m4tr1x-node'); return }
  // Load keys
  await fetch(`${base}/api/v1/nostr/load-keys`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({privkey: k.privkey})})
  // Declare node
  const d = await fetch(`${base}/api/v1/node/declare`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({capabilities:['film','music','reels','topic'], wsPort:4848})}).then(r=>r.json())
  console.log('Node declared:', JSON.stringify(d.config, null, 2))
  // Show onion
  const o = await fetch(`${base}/api/v1/node/onion`).then(r=>r.json()).catch(()=>null)
  if (o?.onion) console.log('Tor .onion:', o.onion)
}
main().catch(console.error)
JSEOF

echo ""
echo "=== Setup complete ==="
echo ""
echo "Node:  http://$(ipconfig getifaddr en0 2>/dev/null || echo localhost):8080"
[ -n "$ONION" ] && echo "Tor:   http://$ONION"
echo "Relay: ws://localhost:4848"
echo ""
echo "Commands:"
echo "  pm2 status          — check node status"
echo "  pm2 logs m4tr1x-node — live logs"
echo "  pm2 restart m4tr1x-node — restart server"
