#!/usr/bin/env bash
# 코르크 ↔ Claude Code 연동 설치 스크립트
#
# 사용법 (코르크 '내 정보' 페이지에서 토큰 발급 후, Claude Code를 쓰는 PC 터미널에서):
#   curl -fsSL <코르크주소>/claude/install.sh | CORK_TOKEN=crk_xxxx bash
# 제거:
#   curl -fsSL <코르크주소>/claude/install.sh | bash -s -- --uninstall
#
# 하는 일:
#  - <클로드 홈>/cork/ 에 저장 훅(save_turn.py)과 설정(config.json) 설치
#  - settings.json 에 Stop 훅 등록 → 대화 한 턴(질문+답변)마다 코르크에 자동 저장
#  - claude mcp add 로 코르크 MCP 서버 등록(user 범위) → cork_* 도구 5개(메모 저장/검색 등)
#  - /cork 슬래시 명령 설치 (저장 위치·주제 확인/변경)
# 클로드 홈은 기본 ~/.claude, CLAUDE_CONFIG_DIR 환경변수가 있으면 그 경로.
set -euo pipefail

CORK_URL="${CORK_URL:-__CORK_URL__}"
CORK_URL="${CORK_URL%/}"
TOKEN="${CORK_TOKEN:-}"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
say() { printf '%s\n' "$*"; }

case "$CORK_URL" in
  __CORK*) say "❌ CORK_URL이 필요합니다. 예: CORK_URL=https://코르크주소 CORK_TOKEN=... bash install.sh"; exit 1 ;;
esac
if ! command -v python3 >/dev/null 2>&1; then
  say "❌ python3를 찾을 수 없습니다. 먼저 설치하세요."; exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  say "❌ claude 명령을 찾을 수 없습니다. Claude Code를 먼저 설치하세요."; exit 1
fi

HOOK_CMD="python3 \"$CLAUDE_DIR/cork/save_turn.py\""

# settings.json의 hooks.Stop에서 코르크 훅을 지우고, 인자로 준 명령이 있으면 추가 (멱등)
edit_settings() {
  python3 - "$CLAUDE_DIR/settings.json" "$1" <<'PY'
import json, os, sys
path, cmd = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(path):
    with open(path, encoding='utf-8') as f:
        data = json.load(f) or {}
hooks = data.setdefault('hooks', {})
stops = hooks.setdefault('Stop', [])
for m in stops:
    m['hooks'] = [h for h in m.get('hooks', []) if 'cork/save_turn.py' not in h.get('command', '')]
stops[:] = [m for m in stops if m.get('hooks')]
if cmd != '--remove':
    stops.append({'hooks': [{'type': 'command', 'command': cmd, 'timeout': 30}]})
if not stops:
    hooks.pop('Stop', None)
if not hooks:
    data.pop('hooks', None)
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
PY
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [ "${1:-}" = "--uninstall" ]; then
  say "▶ 코르크 ↔ Claude Code 연동 제거"
  rm -rf "$CLAUDE_DIR/cork"
  rm -f "$CLAUDE_DIR/commands/cork.md"
  edit_settings --remove
  claude mcp remove cork --scope user >/dev/null 2>&1 || true
  say "✅ 제거 완료"
  exit 0
fi

if [ -z "$TOKEN" ]; then
  say "❌ CORK_TOKEN이 필요합니다. 코르크 '내 정보' 페이지에서 토큰을 발급해 다음처럼 실행하세요:"
  say "   curl -fsSL $CORK_URL/claude/install.sh | CORK_TOKEN=crk_xxxx bash"
  exit 1
fi

say "▶ 토큰 확인 ($CORK_URL)"
if ! curl -fsS -H "Authorization: Bearer $TOKEN" "$CORK_URL/api/hermes/me?format=text" > "$tmp/me.txt" 2>/dev/null; then
  say "❌ 토큰이 유효하지 않거나 서버에 연결할 수 없습니다. 토큰을 다시 발급하거나 주소를 확인하세요."
  exit 1
fi

say "▶ 저장 훅 설치: $CLAUDE_DIR/cork"
mkdir -p "$CLAUDE_DIR/cork" "$CLAUDE_DIR/commands"
curl -fsSL "$CORK_URL/claude/save_turn.py" -o "$CLAUDE_DIR/cork/save_turn.py"
CORK_URL="$CORK_URL" CORK_TOKEN="$TOKEN" python3 - "$CLAUDE_DIR/cork/config.json" <<'PY'
import json, os, sys
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'url': os.environ['CORK_URL'], 'token': os.environ['CORK_TOKEN']}, f, indent=2)
PY
chmod 600 "$CLAUDE_DIR/cork/config.json"

say "▶ /cork 명령 설치: $CLAUDE_DIR/commands/cork.md"
curl -fsSL "$CORK_URL/claude/cork.md" -o "$CLAUDE_DIR/commands/cork.md"

say "▶ settings.json: Stop 훅 등록 (대화 한 턴마다 자동 저장)"
edit_settings "$HOOK_CMD"

say "▶ MCP 서버 등록: cork (user 범위, cork_* 도구 5개)"
claude mcp remove cork --scope user >/dev/null 2>&1 || true
claude mcp add --scope user --transport http cork "$CORK_URL/mcp" --header "Authorization: Bearer $TOKEN" >/dev/null

say ""
say "✅ 설치 완료. 현재 연동 상태:"
cat "$tmp/me.txt"
say ""
say "이제 claude를 새로 실행하면 대화가 자동 저장됩니다. 대화 중 /cork 로 상태를 확인하세요."
say "  /cork 과목 <이름>   과목 선택      /cork 주제 <문구>   단원/예제 설정      /cork off   자동 저장 끄기"
