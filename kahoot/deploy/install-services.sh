#!/usr/bin/env bash
# systemd 유저 서비스로 앱(kahoot)과 터널(kahoot-tunnel)을 등록합니다. sudo 불필요.
#   설치:   ./deploy/install-services.sh
#   상태:   systemctl --user status kahoot kahoot-tunnel
#   로그:   journalctl --user -u kahoot -f   /   journalctl --user -u kahoot-tunnel -f
#   앱 재시작(터널 URL 유지): systemctl --user restart kahoot
#   터널 URL 확인: cat data/tunnel-url.txt
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"
CLOUDFLARED_BIN="$(command -v cloudflared)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"

cat > "$UNIT_DIR/kahoot.service" << UNIT
[Unit]
Description=Classroom Kahoot (Express server)
After=network-online.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN server.js
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT

cat > "$UNIT_DIR/kahoot-tunnel.service" << UNIT
[Unit]
Description=Classroom Kahoot - Cloudflare Quick Tunnel
After=network-online.target kahoot.service
Wants=kahoot.service

[Service]
WorkingDirectory=$APP_DIR
Environment=PATH=$(dirname "$CLOUDFLARED_BIN"):/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/env bash $APP_DIR/tunnel.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now kahoot.service kahoot-tunnel.service

# 로그아웃/재부팅 후에도 유저 서비스가 계속 돌도록 linger 활성화 (실패해도 치명적이지 않음)
if loginctl enable-linger "$USER" 2>/dev/null; then
  echo "[ok] linger 활성화: 로그아웃/재부팅 후에도 서비스가 유지됩니다."
else
  echo "[warn] linger 활성화 실패 — 관리자에게 'sudo loginctl enable-linger $USER' 를 요청하세요."
  echo "       (없으면 SSH 세션이 모두 끊겼을 때 서비스가 멈출 수 있습니다)"
fi

echo
echo "서비스 등록 완료. 터널 URL이 잡힐 때까지 몇 초 기다린 뒤:"
echo "  cat $APP_DIR/data/tunnel-url.txt"
