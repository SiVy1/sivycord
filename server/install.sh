#!/usr/bin/env bash
# ────────────────────────────────────────────────────
#  SivySpeak — lightweight Linux installer
#  Compiles from source and installs as a systemd service.
#  No Docker needed.
# ────────────────────────────────────────────────────
set -euo pipefail

# ── Defaults (override with env vars) ───────────────
INSTALL_DIR="${INSTALL_DIR:-/opt/sivyspeak}"
SERVICE_USER="${SERVICE_USER:-sivyspeak}"
PORT="${PORT:-3000}"
EXTERNAL_HOST="${EXTERNAL_HOST:-localhost}"
EXTERNAL_PORT="${EXTERNAL_PORT:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Root check ──────────────────────────────────────
[[ $EUID -eq 0 ]] || error "Run this script as root (sudo)."

# ── Install system dependencies ─────────────────────
info "Installing build dependencies..."
if command -v apt-get &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq curl gcc pkg-config libssl-dev >/dev/null
elif command -v dnf &>/dev/null; then
    dnf install -y -q curl gcc pkg-config openssl-devel
elif command -v pacman &>/dev/null; then
    pacman -Sy --noconfirm --needed curl gcc pkgconf openssl
else
    warn "Unknown package manager — make sure curl, gcc, pkg-config, and OpenSSL dev headers are installed."
fi

# ── Install Rust (if missing) ───────────────────────
if ! command -v cargo &>/dev/null; then
    info "Installing Rust toolchain..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
    source "$HOME/.cargo/env"
fi

# ── Build ───────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
info "Building sivyspeak-server (release)..."
cd "$SCRIPT_DIR"
cargo build --release

BINARY="$SCRIPT_DIR/target/release/sivyspeak-server"
[[ -f "$BINARY" ]] || error "Build failed — binary not found at $BINARY"

# ── Create system user ──────────────────────────────
if ! id "$SERVICE_USER" &>/dev/null; then
    info "Creating system user '$SERVICE_USER'..."
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# ── Install files ───────────────────────────────────
info "Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"/{data,uploads,migrations}

cp "$BINARY" "$INSTALL_DIR/sivyspeak-server"
cp -r "$SCRIPT_DIR/migrations/"* "$INSTALL_DIR/migrations/" 2>/dev/null || true
chmod +x "$INSTALL_DIR/sivyspeak-server"

chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

# ── Environment file ────────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
    info "Creating $ENV_FILE..."
    cat > "$ENV_FILE" <<EOF
PORT=${PORT}
DATABASE_PATH=${INSTALL_DIR}/data/sivyspeak.db
EXTERNAL_HOST=${EXTERNAL_HOST}
${EXTERNAL_PORT:+EXTERNAL_PORT=${EXTERNAL_PORT}}
# JWT_SECRET=  # leave empty to auto-generate
EOF
    chmod 600 "$ENV_FILE"
    chown "$SERVICE_USER":"$SERVICE_USER" "$ENV_FILE"
else
    warn "$ENV_FILE already exists — not overwriting."
fi

# ── Systemd service ─────────────────────────────────
SERVICE_FILE="/etc/systemd/system/sivyspeak.service"
info "Installing systemd service..."
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=SivySpeak Server
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${INSTALL_DIR}/sivyspeak-server
Restart=on-failure
RestartSec=5

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${INSTALL_DIR}/data ${INSTALL_DIR}/uploads ${INSTALL_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sivyspeak.service

# ── Start ───────────────────────────────────────────
info "Starting sivyspeak..."
systemctl restart sivyspeak.service
sleep 2

if systemctl is-active --quiet sivyspeak.service; then
    info "sivyspeak is running on port ${PORT}!"
    echo ""
    echo "  Useful commands:"
    echo "    sudo systemctl status sivyspeak    # check status"
    echo "    sudo journalctl -u sivyspeak -f    # live logs"
    echo "    sudo systemctl restart sivyspeak   # restart"
    echo "    sudo systemctl stop sivyspeak      # stop"
    echo ""
    echo "  Config: $ENV_FILE"
    echo "  Data:   $INSTALL_DIR/data/"
    echo ""
    info "On first run, check logs for the setup key: sudo journalctl -u sivyspeak --no-pager | grep setup"
else
    error "sivyspeak failed to start. Check: sudo journalctl -u sivyspeak -e"
fi
