#!/usr/bin/env bash
# Cloudflare Quick Tunnel 실행 — 도메인/계정 없이 https://xxxx.trycloudflare.com 주소를 받습니다.
# 주소는 터널을 재시작할 때마다 바뀌므로, 바뀌면 Google Cloud Console의
# "승인된 자바스크립트 원본"을 새 주소로 갱신해야 합니다.
set -euo pipefail
cd "$(dirname "$0")"

PORT=3001
if [ -f .env ]; then
  PORT=$(grep -E '^PORT=' .env | cut -d= -f2 | tr -d '[:space:]' || true)
  PORT=${PORT:-3001}
fi

mkdir -p data
URL_FILE="data/tunnel-url.txt"
: > "$URL_FILE"

echo "[tunnel] http://localhost:$PORT 을(를) 외부에 공개합니다..."
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
    URL="${BASH_REMATCH[1]}"
    echo "$URL" > "$URL_FILE"
    echo
    echo "=================================================================="
    echo "  공개 주소: $URL"
    echo "  -> Google Cloud Console > 사용자 인증 정보 > OAuth 클라이언트"
    echo "     '승인된 자바스크립트 원본'에 위 주소를 등록하세요."
    echo "  (이 주소는 $URL_FILE 에도 저장됩니다)"
    echo "=================================================================="
    echo
  fi
done
