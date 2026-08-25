#!/usr/bin/env bash
# Classroom Padlet ↔ Hermes Agent 연동 설치 스크립트
#
# 사용법 (패들렛 '내 정보' 페이지에서 토큰 발급 후, 헤르메스가 설치된 PC 터미널에서):
#   curl -fsSL <패들렛주소>/hermes/install.sh | PADLET_TOKEN=pdl_xxxx bash
# 제거:
#   curl -fsSL <패들렛주소>/hermes/install.sh | bash -s -- --uninstall
#
# 하는 일: ~/.hermes/plugins/padlet 설치, ~/.hermes/skills/padlet 복사,
#          ~/.hermes/.env 에 PADLET_URL/PADLET_TOKEN 기록, config.yaml에 플러그인 활성화 + MCP 서버 등록
set -euo pipefail

PADLET_URL="${PADLET_URL:-__PADLET_URL__}"
PADLET_URL="${PADLET_URL%/}"
TOKEN="${PADLET_TOKEN:-}"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
say() { printf '%s\n' "$*"; }

case "$PADLET_URL" in
  __PADLET*) say "❌ PADLET_URL이 필요합니다. 예: PADLET_URL=https://패들렛주소 PADLET_TOKEN=... bash install.sh"; exit 1 ;;
esac
if ! command -v hermes >/dev/null 2>&1; then
  say "❌ hermes 명령을 찾을 수 없습니다. 헤르메스(Hermes Agent)를 먼저 설치하세요."; exit 1
fi
if [ ! -d "$HERMES_HOME" ]; then
  say "❌ $HERMES_HOME 디렉토리가 없습니다. hermes를 한 번 실행해 초기화한 뒤 다시 시도하세요."; exit 1
fi
PY="$HERMES_HOME/hermes-agent/venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [ "${1:-}" = "--uninstall" ]; then
  say "▶ 패들렛 연동 제거"
  rm -rf "$HERMES_HOME/plugins/padlet" "$HERMES_HOME/skills/padlet"
  if [ -f "$HERMES_HOME/.env" ]; then
    grep -v -E '^(PADLET_URL|PADLET_TOKEN)=' "$HERMES_HOME/.env" > "$tmp/env" || true
    cat "$tmp/env" > "$HERMES_HOME/.env"
  fi
  curl -fsSL "$PADLET_URL/hermes/plugin.tgz" -o "$tmp/plugin.tgz" && mkdir -p "$tmp/p" && tar -xzf "$tmp/plugin.tgz" -C "$tmp/p" \
    && HERMES_HOME="$HERMES_HOME" "$PY" "$tmp/p/setup_config.py" --remove || say "⚠️ config.yaml은 직접 정리하세요 (plugins.enabled의 padlet, mcp_servers.padlet)"
  say "✅ 제거 완료"
  exit 0
fi

if [ -z "$TOKEN" ]; then
  say "❌ PADLET_TOKEN이 필요합니다. 패들렛 '내 정보' 페이지에서 토큰을 발급해 다음처럼 실행하세요:"
  say "   curl -fsSL $PADLET_URL/hermes/install.sh | PADLET_TOKEN=pdl_xxxx bash"
  exit 1
fi

say "▶ 토큰 확인 ($PADLET_URL)"
if ! curl -fsS -H "Authorization: Bearer $TOKEN" "$PADLET_URL/api/hermes/me?format=text" > "$tmp/me.txt" 2>/dev/null; then
  say "❌ 토큰이 유효하지 않거나 서버에 연결할 수 없습니다. 토큰을 다시 발급하거나 주소를 확인하세요."
  exit 1
fi

say "▶ 플러그인 설치: $HERMES_HOME/plugins/padlet"
curl -fsSL "$PADLET_URL/hermes/plugin.tgz" -o "$tmp/plugin.tgz"
rm -rf "$HERMES_HOME/plugins/padlet"
mkdir -p "$HERMES_HOME/plugins/padlet"
tar -xzf "$tmp/plugin.tgz" -C "$HERMES_HOME/plugins/padlet"

say "▶ 스킬 설치: $HERMES_HOME/skills/padlet"
mkdir -p "$HERMES_HOME/skills"
rm -rf "$HERMES_HOME/skills/padlet"
cp -r "$HERMES_HOME/plugins/padlet/skills/padlet" "$HERMES_HOME/skills/padlet"

say "▶ 설정 저장: $HERMES_HOME/.env (PADLET_URL, PADLET_TOKEN)"
envf="$HERMES_HOME/.env"
touch "$envf"
chmod 600 "$envf"
grep -v -E '^(PADLET_URL|PADLET_TOKEN)=' "$envf" > "$tmp/env" || true
printf 'PADLET_URL=%s\nPADLET_TOKEN=%s\n' "$PADLET_URL" "$TOKEN" >> "$tmp/env"
cat "$tmp/env" > "$envf"

say "▶ config.yaml: 플러그인 활성화 + MCP 서버(padlet) 등록"
HERMES_HOME="$HERMES_HOME" "$PY" "$HERMES_HOME/plugins/padlet/setup_config.py" "$PADLET_URL"

say ""
say "✅ 설치 완료. 현재 연동 상태:"
cat "$tmp/me.txt"
say ""
say "이제 hermes를 새로 실행하면 대화가 자동 저장됩니다. 대화 중 /padlet 으로 상태를 확인하세요."
say "  /padlet 과목 <이름>   과목 선택      /padlet 주제 <문구>   단원/예제 설정      /padlet off   자동 저장 끄기"
